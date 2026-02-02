// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import "../src/BatchSettler.sol";
import "../src/PaymentPool.sol";
import "../src/IntentVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Test Helper: Mock ERC20 ─────────────────────────────────────────────────
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BatchSettlerTest is Test {
    // ─── Contracts ───────────────────────────────────────────────────────────
    PaymentPool pool;
    IntentVault vault;
    BatchSettler settler;
    MockERC20 usdc;
    MockERC20 eurc;

    // ─── Actors ──────────────────────────────────────────────────────────────
    address owner;
    address merchant1;
    address merchant2;
    address merchant3;
    address payer;

    // ─── Setup ───────────────────────────────────────────────────────────────
    function setUp() public {
        owner = address(0x01);
        merchant1 = address(0x02);
        merchant2 = address(0x03);
        merchant3 = address(0x04);
        payer = address(0x05);

        // Deploy all contracts as owner
        vm.startPrank(owner);
        pool = new PaymentPool();
        vault = new IntentVault();
        settler = new BatchSettler(address(pool), address(vault));
        vm.stopPrank();

        // Register BatchSettler as authorized withdrawer on the pool
        vm.prank(owner);
        pool.setAuthorizedWithdrawer(address(settler), true);

        // Deploy tokens and fund the payer
        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");

        usdc.mint(payer, 100_000e6);
        eurc.mint(payer, 50_000e6);

        vm.startPrank(payer);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        // Set up intents for merchants (so they're allowed to be settled)
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        vm.prank(merchant3);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, address(eurc));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── executeBatch: happy path ────────────────────────────────────────────

    /// @notice Single settlement in a batch executes correctly.
    function test_executeBatch_singleSettlement() public {
        // Setup: merchant1 has 100 USDC in the pool
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        // Create a batch with one settlement
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: merchant1 // settle directly to merchant's wallet
        });

        bytes32 batchId = keccak256("batch-001");

        // Execute
        vm.prank(owner);
        settler.executeBatch(batchId, settlements, 0);

        // Verify: pool balance is now zero, merchant received tokens
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), 100e6);
    }

    /// @notice Multiple settlements in a batch execute atomically.
    function test_executeBatch_multipleSettlements() public {
        // Setup: both merchants have balances
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        // Create batch
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] =
            BatchSettler.Settlement({merchant: merchant2, token: address(usdc), amount: 200e6, recipient: merchant2});

        bytes32 batchId = keccak256("batch-002");

        // Execute
        vm.prank(owner);
        settler.executeBatch(batchId, settlements, 50000); // claiming 50k wei gas saved

        // Verify both settled
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), 100e6);
        assertEq(usdc.balanceOf(merchant2), 200e6);
    }

    /// @notice Partial settlement (not draining entire balance) works.
    function test_executeBatch_partialSettlement() public {
        // Setup: merchant has 500 USDC but we only settle 300
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 500e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 300e6, recipient: merchant1});

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-003"), settlements, 0);

        // Verify: 200 USDC remains in pool
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 200e6);
        assertEq(usdc.balanceOf(merchant1), 300e6);
    }

    /// @notice Can settle to a different recipient (e.g. a bridge contract).
    function test_executeBatch_differentRecipient() public {
        address bridgeContract = address(0x99);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: bridgeContract // not the merchant's wallet
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-004"), settlements, 0);

        // Verify: tokens went to bridge, not merchant
        assertEq(usdc.balanceOf(bridgeContract), 100e6);
        assertEq(usdc.balanceOf(merchant1), 0);
    }

    /// @notice Mixed tokens in a batch (USDC + EURC).
    function test_executeBatch_mixedTokens() public {
        // merchant1 has USDC, merchant3 has EURC
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant3, address(eurc), 50e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] =
            BatchSettler.Settlement({merchant: merchant3, token: address(eurc), amount: 50e6, recipient: merchant3});

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-005"), settlements, 0);

        assertEq(usdc.balanceOf(merchant1), 100e6);
        assertEq(eurc.balanceOf(merchant3), 50e6);
    }

    // ─── executeBatch: events ────────────────────────────────────────────────

    /// @notice BatchExecuted event is emitted with correct params.
    function test_executeBatch_emitsBatchExecutedEvent() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});

        bytes32 batchId = keccak256("event-batch");
        uint256 gasSaved = 25000;

        // We can't easily check the settlements array in the event, but we can check the other params
        vm.expectEmit(true, false, false, false);
        emit BatchSettler.BatchExecuted(batchId, settlements, gasSaved);

        vm.prank(owner);
        settler.executeBatch(batchId, settlements, gasSaved);
    }

    /// @notice SettlementExecuted event is emitted for each settlement in batch.
    function test_executeBatch_emitsSettlementExecutedEvents() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] =
            BatchSettler.Settlement({merchant: merchant2, token: address(usdc), amount: 200e6, recipient: merchant2});

        bytes32 batchId = keccak256("multi-event-batch");

        // Expect two SettlementExecuted events
        vm.expectEmit(true, true, true, true);
        emit BatchSettler.SettlementExecuted(batchId, merchant1, address(usdc), 100e6, merchant1);

        vm.expectEmit(true, true, true, true);
        emit BatchSettler.SettlementExecuted(batchId, merchant2, address(usdc), 200e6, merchant2);

        vm.prank(owner);
        settler.executeBatch(batchId, settlements, 0);
    }

    // ─── executeBatch: revert cases ──────────────────────────────────────────

    /// @notice Only owner can execute batches.
    function test_executeBatch_revert_notOwner() public {
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});

        vm.prank(merchant1); // not the owner
        vm.expectRevert(); // OZ Ownable revert
        settler.executeBatch(keccak256("batch-x"), settlements, 0);
    }

    /// @notice Empty batch is rejected.
    function test_executeBatch_revert_emptyBatch() public {
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](0);

        vm.prank(owner);
        vm.expectRevert("BatchSettler: empty batch");
        settler.executeBatch(keccak256("batch-empty"), settlements, 0);
    }

    /// @notice Merchant without intent is rejected.
    function test_executeBatch_revert_noIntent() public {
        address merchantNoIntent = address(0x88);

        vm.prank(payer);
        pool.receivePayment(merchantNoIntent, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchantNoIntent, token: address(usdc), amount: 100e6, recipient: merchantNoIntent
        });

        vm.prank(owner);
        vm.expectRevert("BatchSettler: merchant has no intent");
        settler.executeBatch(keccak256("batch-no-intent"), settlements, 0);
    }

    /// @notice Zero recipient is rejected.
    function test_executeBatch_revert_zeroRecipient() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: address(0) // invalid
        });

        vm.prank(owner);
        vm.expectRevert("BatchSettler: recipient is zero address");
        settler.executeBatch(keccak256("batch-zero-recipient"), settlements, 0);
    }

    /// @notice Zero amount is rejected.
    function test_executeBatch_revert_zeroAmount() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 0, // invalid
            recipient: merchant1
        });

        vm.prank(owner);
        vm.expectRevert("BatchSettler: amount must be positive");
        settler.executeBatch(keccak256("batch-zero-amount"), settlements, 0);
    }

    /// @notice CRITICAL: Insufficient balance causes entire batch to revert (atomicity).
    function test_executeBatch_revert_insufficientBalance_atomicity() public {
        // merchant1 has 100 USDC, merchant2 has 200 USDC
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        // Try to settle merchant1 for 100 (ok) and merchant2 for 300 (not enough)
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2,
            token: address(usdc),
            amount: 300e6, // too much
            recipient: merchant2
        });

        vm.prank(owner);
        vm.expectRevert("PaymentPool: insufficient balance");
        settler.executeBatch(keccak256("batch-insufficient"), settlements, 0);

        // Verify atomicity: merchant1's settlement was also rolled back
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 100e6); // unchanged
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 200e6); // unchanged
        assertEq(usdc.balanceOf(merchant1), 0); // got nothing
        assertEq(usdc.balanceOf(merchant2), 0); // got nothing
    }

    // ─── validateBatch ───────────────────────────────────────────────────────

    /// @notice Valid batch passes validation.
    function test_validateBatch_valid() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] =
            BatchSettler.Settlement({merchant: merchant2, token: address(usdc), amount: 200e6, recipient: merchant2});

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);

        assertTrue(valid);
        assertEq(errorIndex, 0); // ignored when valid
        assertEq(reason, "");
    }

    /// @notice Empty batch fails validation.
    function test_validateBatch_emptyBatch() public view {
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](0);

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);

        assertFalse(valid);
        assertEq(errorIndex, 0);
        assertEq(reason, "Empty batch");
    }

    /// @notice Merchant without intent fails validation and reports correct index.
    function test_validateBatch_noIntent() public {
        address merchantNoIntent = address(0x88);

        vm.prank(payer);
        pool.receivePayment(merchantNoIntent, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchantNoIntent, token: address(usdc), amount: 100e6, recipient: merchantNoIntent
        });

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);

        assertFalse(valid);
        assertEq(errorIndex, 0); // first (and only) settlement is the problem
        assertEq(reason, "Merchant has no intent");
    }

    /// @notice Insufficient balance fails validation at correct index.
    function test_validateBatch_insufficientBalance() public {
        // merchant1 has 100, merchant2 has 200
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        // Try to settle 100 for merchant1 (ok) and 300 for merchant2 (not enough)
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1});
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2,
            token: address(usdc),
            amount: 300e6, // too much
            recipient: merchant2
        });

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);

        assertFalse(valid);
        assertEq(errorIndex, 1); // second settlement is the problem
        assertEq(reason, "Insufficient balance");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Fuzz: any valid single settlement executes correctly.
     *
     * Tests that settlement amount arithmetic is correct for arbitrary values.
     */
    function testFuzz_executeBatch_singleSettlement_amountConsistency(uint256 amount) public {
        amount = bound(amount, 1, 100_000e6); // must be positive and within payer's balance

        // Setup
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, keccak256("fuzz-p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] =
            BatchSettler.Settlement({merchant: merchant1, token: address(usdc), amount: amount, recipient: merchant1});

        // Execute
        vm.prank(owner);
        settler.executeBatch(keccak256("fuzz-batch"), settlements, 0);

        // Verify
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), amount);
    }

    /**
     * @notice Fuzz: partial settlement leaves correct remainder.
     */
    function testFuzz_executeBatch_partialSettlement_remainder(uint256 depositAmount, uint256 settleAmount) public {
        depositAmount = bound(depositAmount, 100, 100_000e6);
        settleAmount = bound(settleAmount, 1, depositAmount); // can't settle more than deposited

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), depositAmount, keccak256("fuzz-p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: settleAmount, recipient: merchant1
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("fuzz-partial"), settlements, 0);

        // Remainder must equal deposit - settle
        uint256 expectedRemainder = depositAmount - settleAmount;
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), expectedRemainder);
        assertEq(usdc.balanceOf(merchant1), settleAmount);
    }
}
