// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract TestToken is ERC20 {
    constructor() ERC20("Local test USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    bool public fail;
    address public callback;
    bytes public payload;
    bool public reentrySucceeded;
    function setFail(bool value) external { fail = value; }
    function setCallback(address target, bytes calldata data) external { callback = target; payload = data; }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        if (callback != address(0)) { (reentrySucceeded,) = callback.call(payload); }
        return super.transfer(to, amount);
    }
}
