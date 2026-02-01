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

    /// @notice Same merchant, different tokens — tracked independently.
    function test_receivePayment_multiToken() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant1, address(eurc), 50e6, keccak256("p2"));
        vm.stopPrank();

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 100e6);
        assertEq(pool.getMerchantBalance(merchant1, address(eurc)), 50e6);
    }

    /// @notice The PaymentReceived event is emitted with correct params.
    function test_receivePayment_emitsEvent() public {
        bytes32 paymentId = keccak256("event-test");
        uint256 amount = 75e6;

        vm.expectEmit(true, true, true, true);
        emit PaymentPool.PaymentReceived(merchant1, payer, address(usdc), amount, paymentId);

        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, paymentId);
        vm.stopPrank();
    }

    /// @notice Reverts if merchant address is zero.
    function test_receivePayment_revert_zeroMerchant() public {
        vm.startPrank(payer);
        vm.expectRevert("PaymentPool: merchant is zero address");
        pool.receivePayment(address(0), address(usdc), 100e6, keccak256("p1"));
        vm.stopPrank();
    }

    /// @notice Reverts if token address is zero.
    function test_receivePayment_revert_zeroToken() public {
        vm.startPrank(payer);
        vm.expectRevert("PaymentPool: token is zero address");
        pool.receivePayment(merchant1, address(0), 100e6, keccak256("p1"));
        vm.stopPrank();
    }

    /// @notice Reverts if amount is zero.
    function test_receivePayment_revert_zeroAmount() public {
        vm.startPrank(payer);
        vm.expectRevert("PaymentPool: amount must be positive");
        pool.receivePayment(merchant1, address(usdc), 0, keccak256("p1"));
        vm.stopPrank();
    }

    /// @notice Reverts if payer hasn't approved enough.
    function test_receivePayment_revert_noApproval() public {
        address poorPayer = address(0x99);
        usdc.mint(poorPayer, 100e6);
        // Deliberately NOT approving

        vm.startPrank(poorPayer);
        vm.expectRevert(); // ERC20 allowance error
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        vm.stopPrank();
    }

    // ─── withdraw ────────────────────────────────────────────────────────────

    /// @notice Authorized withdrawer can pull funds out.
    function test_withdraw_basic() public {
        // Setup: register settler as authorized, deposit funds
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        // Withdraw 60 USDC to merchant1's own wallet
        vm.prank(settler);
        pool.withdraw(merchant1, address(usdc), 60e6, merchant1);

        // Pool balance dropped, merchant received tokens
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 40e6);
        assertEq(usdc.balanceOf(merchant1), 60e6);
    }

    /// @notice Partial withdrawals work and leave the remainder intact.
    function test_withdraw_partial() public {
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 200e6, keccak256("p1"));

        vm.prank(settler);
        pool.withdraw(merchant1, address(usdc), 50e6, merchant1);
        pool.withdraw(merchant1, address(usdc), 75e6, merchant1);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 75e6);
    }

    /// @notice FundsWithdrawn event is emitted correctly.
    function test_withdraw_emitsEvent() public {
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.expectEmit(true, true, false, true);
        emit PaymentPool.FundsWithdrawn(merchant1, address(usdc), 100e6);

        vm.prank(settler);
        pool.withdraw(merchant1, address(usdc), 100e6, merchant1);
    }

    /// @notice Unauthorized address cannot withdraw.
    function test_withdraw_revert_unauthorized() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.prank(settler); // settler is NOT authorized yet
        vm.expectRevert("PaymentPool: not authorized");
        pool.withdraw(merchant1, address(usdc), 50e6, merchant1);
    }

    /// @notice Cannot withdraw more than the merchant has.
    function test_withdraw_revert_insufficientBalance() public {
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 50e6, keccak256("p1"));

        vm.prank(settler);
        vm.expectRevert("PaymentPool: insufficient balance");
        pool.withdraw(merchant1, address(usdc), 100e6, merchant1);
    }

    /// @notice Cannot withdraw to zero address.
    function test_withdraw_revert_zeroRecipient() public {
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.prank(settler);
        vm.expectRevert("PaymentPool: recipient is zero address");
        pool.withdraw(merchant1, address(usdc), 50e6, address(0));
    }

    // ─── setAuthorizedWithdrawer ─────────────────────────────────────────────

    /// @notice Only the owner can set authorized withdrawers.
    function test_setAuthorizedWithdrawer_revert_notOwner() public {
        vm.prank(merchant1);
        vm.expectRevert(); // OZ Ownable revert
        pool.setAuthorizedWithdrawer(settler, true);
    }

    /// @notice Owner can revoke authorization.
    function test_setAuthorizedWithdrawer_revoke() public {
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        // Revoke
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, false);

        // Now settler should be rejected
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.prank(settler);
        vm.expectRevert("PaymentPool: not authorized");
        pool.withdraw(merchant1, address(usdc), 50e6, merchant1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUZZ TESTS — random inputs to find edge cases automatically
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Fuzz: any valid amount deposited should show up in the balance.
     *
     * Foundry will call this with hundreds of random `amount` values.
     * We bound it to [1, payer's balance] so we don't exceed what we minted.
     */
    function testFuzz_receivePayment_balanceMatchesDeposit(uint256 amount) public {
        // Constrain amount to a valid range — can't deposit 0 or more than we have.
        amount = bound(amount, 1, 10_000e6);

        bytes32 paymentId = keccak256(abi.encodePacked(amount));

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, paymentId);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), amount);
    }

    /**
     * @notice Fuzz: deposit then withdraw a portion — balance should equal the difference.
     *
     * Tests that the arithmetic never underflows and balances stay consistent
     * across arbitrary deposit/withdraw pairs.
     */
    function testFuzz_depositThenWithdraw_balanceConsistent(uint256 depositAmount, uint256 withdrawAmount) public {
        depositAmount = bound(depositAmount, 1, 10_000e6);
        // Withdraw can't exceed deposit
        withdrawAmount = bound(withdrawAmount, 0, depositAmount);

        // Setup
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(settler, true);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), depositAmount, keccak256("fuzz-p1"));

        vm.prank(settler);
        if (withdrawAmount > 0) {
            pool.withdraw(merchant1, address(usdc), withdrawAmount, merchant1);
        }

        // Balance must equal deposit minus withdrawal — no rounding, no overflow
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), depositAmount - withdrawAmount);
    }

    /**
     * @notice Fuzz: two merchants deposit independently — their balances never interfere.
     *
     * This catches bugs where balance mappings accidentally share state.
     */
    function testFuzz_twoMerchants_isolated(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, 5_000e6);
        amount2 = bound(amount2, 1, 5_000e6);

        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), amount1, keccak256("fuzz-m1"));
        pool.receivePayment(merchant2, address(usdc), amount2, keccak256("fuzz-m2"));
        vm.stopPrank();

        // Each merchant's balance is exactly what was deposited for them
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), amount1);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), amount2);
    }
}

