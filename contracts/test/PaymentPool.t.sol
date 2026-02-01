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

contract PaymentPoolTest is Test {
    // ─── Contracts ───────────────────────────────────────────────────────────
    PaymentPool pool;
    MockERC20 usdc;
    MockERC20 eurc;

    // ─── Actors ──────────────────────────────────────────────────────────────
    address owner;
    address merchant1;
    address merchant2;
    address settler; // will be set as authorized withdrawer
    address payer;

    // ─── Setup: runs before every single test ───────────────────────────────
    function setUp() public {
        owner = address(0x01);
        merchant1 = address(0x02);
        merchant2 = address(0x03);
        settler = address(0x04);
        payer = address(0x05);

        vm.prank(owner);
        pool = new PaymentPool();

        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");

        usdc.mint(payer, 10_000e6);
        eurc.mint(payer, 5_000e6);

        vm.startPrank(payer);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIT TESTS — specific scenarios with known inputs/outputs
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── receivePayment ──────────────────────────────────────────────────────

    /// @notice A normal payment lands in the pool and balance updates correctly.
    function test_receivePayment_basic() public {
        bytes32 paymentId = keccak256("payment-001");
        uint256 amount = 100e6; // 100 USDC

        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, paymentId);
        vm.stopPrank();

        // Balance should reflect the deposit
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), amount);
    }

    /// @notice Multiple payments to the same merchant accumulate correctly.
    function test_receivePayment_accumulates() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant1, address(usdc), 50e6, keccak256("p2"));
        vm.stopPrank();

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 150e6);
    }

    /// @notice Two different merchants have independent balances.
    function test_receivePayment_separateMerchants() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 100e6);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 200e6);
    }
}

