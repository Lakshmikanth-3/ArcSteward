// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice All amounts use the 6-decimal ERC-20 USDC interface; never native gas units.
contract ArcVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    IERC20 public immutable usdc;
    struct Capability {
        uint256 maxTotal;
        uint256 maxPayment;
        uint256 spent;
        uint64 expiresAt;
        uint64 version;
        bool active;
    }
    mapping(address => Capability) public capabilities;
    mapping(address => mapping(uint64 => mapping(address => bool))) private recipients;
    mapping(address => mapping(bytes32 => bool)) public usedPaymentIds;
    error NotOwner();
    error InvalidInput();
    error Unauthorized();
    error Expired();
    error RecipientDenied();
    error PaymentLimit();
    error TotalLimit();
    error InsufficientFunds();
    error DuplicatePayment();
    error UnsupportedToken();
    event Funded(address indexed sender, uint256 amount);
    event Authorized(address indexed agent, uint64 version, uint256 maxTotal, uint256 maxPayment, uint64 expiresAt, address[] recipients);
    event Paid(address indexed agent, address indexed recipient, bytes32 indexed paymentId, uint256 amount, uint256 remainingBudget);
    event Revoked(address indexed agent);
    event Withdrawn(address indexed recipient, uint256 amount);

    constructor(address owner_, address token_) {
        if (owner_ == address(0) || token_ == address(0)) revert InvalidInput();
        if (IERC20Metadata(token_).decimals() != 6) revert UnsupportedToken();
        owner = owner_;
        usdc = IERC20(token_);
    }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    function balance() public view returns (uint256) { return usdc.balanceOf(address(this)); }
    function allowed(address agent, address recipient) public view returns (bool) {
        return recipients[agent][capabilities[agent].version][recipient];
    }
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidInput();
        uint256 beforeBalance = balance();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        if (balance() - beforeBalance != amount) revert UnsupportedToken();
        emit Funded(msg.sender, amount);
    }
    /// Updates preserve lifetime spend; maxTotal is a lifetime ceiling for this agent/vault.
    function authorize(address agent, uint256 maxTotal, uint256 maxPayment, uint64 expiresAt, address[] calldata list) external onlyOwner nonReentrant {
        Capability storage c = capabilities[agent];
        if (agent == address(0) || agent == owner || maxTotal == 0 || maxTotal < c.spent || maxPayment == 0 || maxPayment > maxTotal || expiresAt <= block.timestamp || list.length == 0 || list.length > 100) revert InvalidInput();
        c.version++;
        c.maxTotal = maxTotal;
        c.maxPayment = maxPayment;
        c.expiresAt = expiresAt;
        c.active = true;
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == address(0) || list[i] == address(this)) revert InvalidInput();
            recipients[agent][c.version][list[i]] = true;
        }
        emit Authorized(agent, c.version, maxTotal, maxPayment, expiresAt, list);
    }
    function revoke(address agent) external onlyOwner nonReentrant {
        capabilities[agent].active = false;
        emit Revoked(agent);
    }
    function pay(address recipient, uint256 amount, bytes32 paymentId) external nonReentrant {
        Capability storage c = capabilities[msg.sender];
        if (!c.active) revert Unauthorized();
        if (block.timestamp >= c.expiresAt) revert Expired();
        if (!allowed(msg.sender, recipient)) revert RecipientDenied();
        if (amount == 0 || paymentId == bytes32(0)) revert InvalidInput();
        if (usedPaymentIds[msg.sender][paymentId]) revert DuplicatePayment();
        if (amount > c.maxPayment) revert PaymentLimit();
        if (amount > c.maxTotal - c.spent) revert TotalLimit();
        if (amount > balance()) revert InsufficientFunds();
        c.spent += amount;
        usedPaymentIds[msg.sender][paymentId] = true;
        usdc.safeTransfer(recipient, amount);
        emit Paid(msg.sender, recipient, paymentId, amount, c.maxTotal - c.spent);
    }
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidInput();
        if (amount > balance()) revert InsufficientFunds();
        usdc.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }
}

contract ArcVaultFactory {
    address public immutable usdc;
    mapping(address => address) public vaultOf;
    event VaultCreated(address indexed owner, address indexed vault);
    constructor(address token) {
        if (IERC20Metadata(token).decimals() != 6) revert ArcVault.UnsupportedToken();
        usdc = token;
    }
    function createVault() external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert ArcVault.InvalidInput();
        vault = address(new ArcVault(msg.sender, usdc));
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault);
    }
}
