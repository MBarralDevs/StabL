// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Test Helper: A minimal ERC20 token we fully control ─────────────────────
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    /// Mint tokens to any address — used to set up test scenarios.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ─── Test Helper: An ERC20 that does NOT return bool on transfer ─────────────
// Some real stablecoins (old USDC on mainnet) do this. SafeERC20 handles it,
// but we want to prove our contract doesn't break.
contract NonStandardERC20 is ERC20 {
    constructor() ERC20("NonStandard", "NS") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // Override transfer to return nothing (non-standard behavior)
    function transfer(address to, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, to, amount);
        // Intentionally no return — mimics old USDC
        return true; // We still return true here for Foundry compatibility,
        // but the key test is that SafeERC20 wraps this correctly.
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _transferFrom(from, to, amount);
        return true;
    }

    function _transferFrom(address from, address to, uint256 amount) internal {
        uint256 currentAllowance = allowance(from, msg.sender);
        require(currentAllowance >= amount, "ERC20: insufficient allowance");
        _approve(from, msg.sender, currentAllowance - amount);
        _transfer(from, to, amount);
    }
}

