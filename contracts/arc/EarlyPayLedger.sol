// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Read-only view of an ArcVault, used to check who may record decisions.
interface IArcVaultView {
    function owner() external view returns (address);
    function capabilities(address agent) external view returns (
        uint256 maxTotal, uint256 maxPayment, uint256 maxPerDay, uint256 gasAllowance,
        uint256 spent, uint256 gasSpent, uint256 daySpent, uint64 day,
        uint64 expiresAt, uint64 version, bool active, bool useRegistry);
}

/// EarlyPay ledger: supplier registry, EIP-712 early-payment offers and an
/// append-only, hash-chained decision log per vault. It never holds or moves
/// funds; payments only ever move through ArcVault.pay (agent) or the owner's
/// own wallet (human approval). No admin, no upgrades.
contract EarlyPayLedger is EIP712 {
    enum Decision { PAY_EARLY, HOLD, ESCALATE, REJECT, HUMAN_APPROVED }

    struct Supplier {
        address payout;        // where early payments may go
        bytes32 profileHash;   // hash of off-chain profile (name, contact, etc.)
        uint64 payoutSince;    // when the current payout address was set
        bool registered;
    }

    struct Offer {
        address vault;         // buyer's ArcVault
        address supplier;      // supplier identity (signer)
        bytes32 invoiceHash;
        uint256 faceAmount;    // USDC, 6 decimals
        uint16 discountBps;    // e.g. 200 = 2%
        address payout;
        uint64 dueDate;
        uint64 expiry;         // offer valid until
    }

    bytes32 public constant REGISTRATION_TYPEHASH = keccak256(
        "Registration(address supplier,address payout,bytes32 profileHash,uint256 nonce)");
    bytes32 public constant OFFER_TYPEHASH = keccak256(
        "Offer(address vault,address supplier,bytes32 invoiceHash,uint256 faceAmount,uint16 discountBps,address payout,uint64 dueDate,uint64 expiry)");

    /// Seconds a changed payout address must wait before it can receive early payments (anti-BEC).
    uint64 public immutable payoutCooldown;

    mapping(address => Supplier) public suppliers;
    mapping(address => bytes32) public chainHead;                         // vault => latest decision hash
    mapping(address => uint256) public decisionCount;                     // vault => number of decisions
    mapping(address => uint256) public nonces;                            // supplier => registration nonce
    mapping(bytes32 => bool) public submitted;                            // offer hash => submitted
    mapping(address => mapping(bytes32 => bool)) public settled;          // vault => invoice => paid

    error InvalidInput();
    error NotRecorder();
    error BadSignature();
    error OfferExpired();
    error NotRegistered();
    error PayoutMismatch();
    error PayoutCoolingDown();
    error AlreadySettled();
    error StaleChain();

    event OfferSubmitted(address indexed vault, address indexed supplier, bytes32 indexed invoiceHash, bytes32 offerHash, Offer offer, bytes signature, string meta);
    event SupplierRegistered(address indexed supplier, address indexed payout, bytes32 profileHash, bool payoutChanged);
    event DecisionRecorded(address indexed vault, bytes32 indexed invoiceHash, Decision decision, bytes32 offerHash, bytes32 inputsHash, bytes32 decisionHash, bytes32 prevHash, address recorder);
    event DecisionNote(address indexed vault, bytes32 indexed decisionHash, string note);
    event Settled(address indexed vault, bytes32 indexed invoiceHash, address indexed payout, uint256 amount, bytes32 paymentTx, address recorder);

    constructor(uint64 cooldown) EIP712("ArcSteward EarlyPay", "1") { payoutCooldown = cooldown; }

    // ── Suppliers ────────────────────────────────────────────────────────────
    /// A supplier registers or changes its own payout address. Only the supplier's key can do this;
    /// a changed address restarts the cooldown before early payments may reach it.
    function registerSupplier(address payout, bytes32 profileHash) external { _register(msg.sender, payout, profileHash); }

    /// Gasless registration: anyone may relay the supplier's EIP-712 signature.
    function registerSupplierBySig(address supplier, address payout, bytes32 profileHash, bytes calldata signature) external {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REGISTRATION_TYPEHASH, supplier, payout, profileHash, nonces[supplier])));
        if (ECDSA.recover(digest, signature) != supplier) revert BadSignature();
        nonces[supplier] += 1;
        _register(supplier, payout, profileHash);
    }

    function _register(address supplier, address payout, bytes32 profileHash) private {
        if (payout == address(0) || supplier == address(0)) revert InvalidInput();
        Supplier storage s = suppliers[supplier];
        bool changed = !s.registered || s.payout != payout;
        if (changed) { s.payout = payout; s.payoutSince = uint64(block.timestamp); }
        s.profileHash = profileHash;
        s.registered = true;
        emit SupplierRegistered(supplier, payout, profileHash, changed);
    }

    function payoutReady(address supplier) public view returns (bool) {
        Supplier storage s = suppliers[supplier];
        return s.registered && block.timestamp >= uint256(s.payoutSince) + payoutCooldown;
    }

    // ── Offers ───────────────────────────────────────────────────────────────
    function offerHash(Offer calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(OFFER_TYPEHASH, o.vault, o.supplier, o.invoiceHash, o.faceAmount, o.discountBps, o.payout, o.dueDate, o.expiry)));
    }

    /// Reverts with the reason an offer may not be paid early; returns its hash if it may.
    function checkOffer(Offer calldata o, bytes calldata signature) public view returns (bytes32 hash) {
        hash = offerHash(o);
        if (o.faceAmount == 0 || o.discountBps > 5_000 || o.invoiceHash == bytes32(0)) revert InvalidInput();
        if (ECDSA.recover(hash, signature) != o.supplier) revert BadSignature();
        if (block.timestamp > o.expiry) revert OfferExpired();
        Supplier storage s = suppliers[o.supplier];
        if (!s.registered) revert NotRegistered();
        if (o.payout != s.payout) revert PayoutMismatch();
        if (!payoutReady(o.supplier)) revert PayoutCoolingDown();
        if (settled[o.vault][o.invoiceHash]) revert AlreadySettled();
    }

    /// Publishes a supplier-signed offer so the buyer's agent can find it (anyone may relay).
    /// `meta` is invoice detail as JSON (number, description, notes); it is untrusted data.
    function submitOffer(Offer calldata o, bytes calldata signature, string calldata meta) external returns (bytes32 hash) {
        hash = offerHash(o);
        if (o.faceAmount == 0 || o.invoiceHash == bytes32(0) || o.vault == address(0)) revert InvalidInput();
        if (ECDSA.recover(hash, signature) != o.supplier) revert BadSignature();
        if (submitted[hash]) revert InvalidInput();
        submitted[hash] = true;
        emit OfferSubmitted(o.vault, o.supplier, o.invoiceHash, hash, o, signature, meta);
    }

    // ── Decision log ─────────────────────────────────────────────────────────
    /// The vault owner or an active, unexpired agent of that vault may record.
    function isRecorder(address vault, address who) public view returns (bool) {
        if (vault.code.length == 0) return false;
        if (IArcVaultView(vault).owner() == who) return true;
        (,,,,,,,, uint64 expiresAt,, bool active,) = IArcVaultView(vault).capabilities(who);
        return active && block.timestamp < expiresAt;
    }

    /// Records HOLD / ESCALATE / REJECT (or any decision with no payment attached).
    /// `prevHash` must equal the vault's current chain head, so the log cannot fork.
    /// `note` carries the human-readable reason and the math as JSON (hash it into inputsHash off-chain).
    function recordDecision(address vault, bytes32 invoiceHash, bytes32 offerHash_, Decision decision, bytes32 inputsHash, bytes32 prevHash, string calldata note) public returns (bytes32 decisionHash) {
        if (!isRecorder(vault, msg.sender)) revert NotRecorder();
        if (invoiceHash == bytes32(0)) revert InvalidInput();
        if (prevHash != chainHead[vault]) revert StaleChain();
        decisionHash = _link(vault, invoiceHash, offerHash_, decision, inputsHash, prevHash);
        emit DecisionNote(vault, decisionHash, note);
    }

    function _link(address vault, bytes32 invoiceHash, bytes32 offerHash_, Decision decision, bytes32 inputsHash, bytes32 prevHash) private returns (bytes32 decisionHash) {
        uint256 n = decisionCount[vault];
        decisionHash = keccak256(abi.encode(vault, invoiceHash, offerHash_, decision, inputsHash, prevHash, n));
        chainHead[vault] = decisionHash;
        decisionCount[vault] = n + 1;
        emit DecisionRecorded(vault, invoiceHash, decision, offerHash_, inputsHash, decisionHash, prevHash, msg.sender);
    }

    /// Records a PAY_EARLY decision; only succeeds if the signed offer passes every check.
    function recordPayEarly(Offer calldata o, bytes calldata signature, bytes32 inputsHash, bytes32 prevHash, string calldata note) external returns (bytes32) {
        bytes32 h = checkOffer(o, signature);
        return recordDecision(o.vault, o.invoiceHash, h, Decision.PAY_EARLY, inputsHash, prevHash, note);
    }

    /// Links a payment (vault Paid tx or the owner's own transfer) to an invoice. Once per invoice.
    function recordSettlement(address vault, bytes32 invoiceHash, address payout, uint256 amount, bytes32 paymentTx) external {
        if (!isRecorder(vault, msg.sender)) revert NotRecorder();
        if (settled[vault][invoiceHash]) revert AlreadySettled();
        if (amount == 0 || payout == address(0)) revert InvalidInput();
        settled[vault][invoiceHash] = true;
        emit Settled(vault, invoiceHash, payout, amount, paymentTx, msg.sender);
    }

    function domainSeparator() external view returns (bytes32) { return _domainSeparatorV4(); }
}
