// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
        settler = new BatchSettler(address(pool), address(vault), address(0)); // no poolManager for same-token tests
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

        // Set up intents for merchants
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, address(usdc));

        vm.prank(merchant3);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, address(eurc));

        // Whitelist tokens
        vm.startPrank(owner);
        pool.setTokenSupport(address(usdc), true);
        pool.setTokenSupport(address(eurc), true);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── executeBatch: happy path ────────────────────────────────────────────

    /// @notice Single settlement in a batch executes correctly.
    function test_executeBatch_singleSettlement() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-001"), settlements, 0);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), 100e6);
    }

    /// @notice Multiple settlements in a batch execute atomically.
    function test_executeBatch_multipleSettlements() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 200e6, recipient: merchant2, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-002"), settlements, 50000);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), 100e6);
        assertEq(usdc.balanceOf(merchant2), 200e6);
    }

    /// @notice Partial settlement (not draining entire balance) works.
    function test_executeBatch_partialSettlement() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 500e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 300e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-003"), settlements, 0);

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
            recipient: bridgeContract,
            outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-004"), settlements, 0);

        assertEq(usdc.balanceOf(bridgeContract), 100e6);
        assertEq(usdc.balanceOf(merchant1), 0);
    }

    /// @notice Mixed tokens in a batch (USDC + EURC), both same-token.
    function test_executeBatch_mixedTokens() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant3, address(eurc), 50e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant3, token: address(eurc), amount: 50e6, recipient: merchant3, outputToken: address(eurc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-005"), settlements, 0);

        assertEq(usdc.balanceOf(merchant1), 100e6);
        assertEq(eurc.balanceOf(merchant3), 50e6);
    }

    // ─── executeBatch: events ────────────────────────────────────────────────

    /// @notice BatchExecuted event is emitted with correct params.
    function test_executeBatch_emitsBatchEvent() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.expectEmit(true, false, false, true);
        emit BatchSettler.BatchExecuted(keccak256("batch-event"), 1, 0);

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-event"), settlements, 0);
    }

    /// @notice SettlementExecuted event is emitted per settlement.
    function test_executeBatch_emitsSettlementEvent() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.expectEmit(true, true, true, true);
        emit BatchSettler.SettlementExecuted(keccak256("batch-se"), merchant1, address(usdc), 100e6, merchant1);

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-se"), settlements, 0);
    }

    // ─── executeBatch: revert cases ──────────────────────────────────────────

    /// @notice Empty batch reverts.
    function test_executeBatch_revert_emptyBatch() public {
        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](0);

        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__EmptyBatch.selector);
        settler.executeBatch(keccak256("batch-empty"), settlements, 0);
    }

    /// @notice Only owner can call executeBatch.
    function test_executeBatch_revert_notOwner() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(merchant1);
        vm.expectRevert();
        settler.executeBatch(keccak256("batch-notowner"), settlements, 0);
    }

    /// @notice Batch with merchant who has no intent reverts.
    function test_executeBatch_revert_noIntent() public {
        address noIntentMerchant = address(0xDEAD);

        vm.prank(payer);
        pool.receivePayment(noIntentMerchant, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: noIntentMerchant,
            token: address(usdc),
            amount: 100e6,
            recipient: noIntentMerchant,
            outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BatchSettler.BatchSettler__MerchantHasNoIntent.selector, noIntentMerchant)
        );
        settler.executeBatch(keccak256("batch-nointent"), settlements, 0);
    }

    /// @notice Insufficient balance in pool reverts entire batch (atomicity).
    function test_executeBatch_revert_insufficientBalance_atomic() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 300e6, recipient: merchant2, outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                PaymentPool.PaymentPool__InsufficientBalance.selector, merchant2, address(usdc), 300e6, 200e6
            )
        );
        settler.executeBatch(keccak256("batch-insufficient"), settlements, 0);

        // Verify atomicity: merchant1's settlement was also rolled back
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 100e6);
        assertEq(usdc.balanceOf(merchant1), 0);
    }

    /// @notice Batch exceeding maxBatchSize reverts.
    function test_executeBatch_revert_batchTooLarge() public {
        vm.prank(owner);
        settler.setMaxBatchSize(1);

        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 100e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 100e6, recipient: merchant2, outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BatchSettler.BatchSettler__BatchTooLarge.selector, 2, 1));
        settler.executeBatch(keccak256("batch-toolarge"), settlements, 0);
    }

    /// @notice Zero-address recipient reverts.
    function test_executeBatch_revert_zeroRecipient() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: address(0), outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__ZeroAddress.selector);
        settler.executeBatch(keccak256("batch-zero-recipient"), settlements, 0);
    }

    /// @notice Zero amount reverts.
    function test_executeBatch_revert_zeroAmount() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 0, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__ZeroAmount.selector);
        settler.executeBatch(keccak256("batch-zero-amount"), settlements, 0);
    }

    // ─── validateBatch ───────────────────────────────────────────────────────

    /// @notice validateBatch returns true for a valid batch.
    function test_validateBatch_valid() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        (bool valid,,) = settler.validateBatch(settlements);
        assertTrue(valid);
    }

    /// @notice validateBatch catches insufficient balance.
    function test_validateBatch_insufficientBalance() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 300e6, recipient: merchant2, outputToken: address(usdc)
        });

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);

        assertFalse(valid);
        assertEq(errorIndex, 1);
        assertEq(reason, "Insufficient balance");
    }

    // ─── Pausable ────────────────────────────────────────────────────────────

    /// @notice executeBatch reverts when paused.
    function test_executeBatch_revert_whenPaused() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.prank(owner);
        settler.pause();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        settler.executeBatch(keccak256("batch-paused"), settlements, 0);
    }

    /// @notice validateBatch still works when paused.
    function test_validateBatch_worksWhenPaused() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.prank(owner);
        settler.pause();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        (bool valid,,) = settler.validateBatch(settlements);
        assertTrue(valid);
    }

    /// @notice Settlements resume after unpausing.
    function test_executeBatch_resumeAfterUnpause() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        vm.startPrank(owner);
        settler.pause();
        settler.unpause();
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-resumed"), settlements, 0);

        assertEq(usdc.balanceOf(merchant1), 100e6);
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @notice Constructor reverts with zero PaymentPool address.
    function test_constructor_revert_zeroPaymentPool() public {
        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__ZeroAddress.selector);
        new BatchSettler(address(0), address(vault), address(0));
    }

    /// @notice Constructor reverts with zero IntentVault address.
    function test_constructor_revert_zeroIntentVault() public {
        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__ZeroAddress.selector);
        new BatchSettler(address(pool), address(0), address(0));
    }

    // ─── Direct-to-Recipient Settlement ──────────────────────────────────────

    /// @notice BatchSettler never holds tokens during settlement.
    function test_executeBatch_settlerHoldsNoTokens() public {
        vm.startPrank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));
        pool.receivePayment(merchant2, address(usdc), 200e6, keccak256("p2"));
        vm.stopPrank();

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](2);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });
        settlements[1] = BatchSettler.Settlement({
            merchant: merchant2, token: address(usdc), amount: 200e6, recipient: merchant2, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-no-hold"), settlements, 0);

        assertEq(usdc.balanceOf(address(settler)), 0);
        assertEq(usdc.balanceOf(merchant1), 100e6);
        assertEq(usdc.balanceOf(merchant2), 200e6);
    }

    /// @notice Settlement can go to a different recipient than the merchant.
    function test_executeBatch_customRecipient() public {
        address customRecipient = address(0xBEEF);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: customRecipient,
            outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-custom"), settlements, 0);

        assertEq(usdc.balanceOf(customRecipient), 100e6);
        assertEq(usdc.balanceOf(merchant1), 0);
        assertEq(usdc.balanceOf(address(settler)), 0);
    }

    /// @notice Pool balance is zero after full settlement.
    function test_executeBatch_poolBalanceZeroAfterFull() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-drain"), settlements, 0);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(address(pool)), 0);
        assertEq(usdc.balanceOf(address(settler)), 0);
    }

    // ─── Fee Mechanism ───────────────────────────────────────────────────────

    /// @notice Settlement with fees deducts correct amounts.
    function test_executeBatch_withFees() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 100); // 1%

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 1000e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-fee"), settlements, 0);

        // Merchant gets 990 (1000 - 1%), fee recipient gets 10
        assertEq(usdc.balanceOf(merchant1), 990e6);
        assertEq(usdc.balanceOf(owner), 10e6);
    }

    /// @notice Zero fee config means no fees taken.
    function test_executeBatch_zeroFees() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 1000e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-no-fee"), settlements, 0);

        assertEq(usdc.balanceOf(merchant1), 1000e6);
    }

    /// @notice BatchSettler holds no tokens even with fees.
    function test_executeBatch_withFees_settlerHoldsNothing() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 100);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 1000e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-no-hold-fee"), settlements, 0);

        assertEq(usdc.balanceOf(address(settler)), 0);
    }

    /// @notice FeeCollected event is emitted.
    function test_executeBatch_withFees_emitsEvent() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 100); // 1%

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 1000e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 1000e6, recipient: merchant1, outputToken: address(usdc)
        });

        vm.expectEmit(true, true, true, true);
        emit BatchSettler.FeeCollected(keccak256("batch-fee-event"), merchant1, address(usdc), 10e6);

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-fee-event"), settlements, 0);
    }

    // ─── setFeeConfig ────────────────────────────────────────────────────────

    function test_setFeeConfig() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 30);
        assertEq(settler.feeRecipient(), owner);
        assertEq(settler.feeBasisPoints(), 30);
    }

    function test_setFeeConfig_revert_tooHigh() public {
        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__InvalidFee.selector);
        settler.setFeeConfig(owner, 1001);
    }

    function test_setFeeConfig_atCap() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 1000);
        assertEq(settler.feeBasisPoints(), 1000);
    }

    function test_setFeeConfig_revert_noRecipient() public {
        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__FeeRecipientNotSet.selector);
        settler.setFeeConfig(address(0), 50);
    }

    function test_setFeeConfig_disableFees() public {
        vm.prank(owner);
        settler.setFeeConfig(owner, 100);
        vm.prank(owner);
        settler.setFeeConfig(address(0), 0);
        assertEq(settler.feeBasisPoints(), 0);
        assertEq(settler.feeRecipient(), address(0));
    }

    function test_setFeeConfig_revert_notOwner() public {
        vm.prank(merchant1);
        vm.expectRevert();
        settler.setFeeConfig(merchant1, 100);
    }

    function test_setFeeConfig_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit BatchSettler.FeeConfigUpdated(owner, 30);
        vm.prank(owner);
        settler.setFeeConfig(owner, 30);
    }

    // ─── setMaxBatchSize ─────────────────────────────────────────────────────

    function test_setMaxBatchSize() public {
        vm.prank(owner);
        settler.setMaxBatchSize(100);
        assertEq(settler.maxBatchSize(), 100);
    }

    function test_setMaxBatchSize_revert_zero() public {
        vm.prank(owner);
        vm.expectRevert(BatchSettler.BatchSettler__InvalidMaxBatchSize.selector);
        settler.setMaxBatchSize(0);
    }

    function test_setMaxBatchSize_revert_notOwner() public {
        vm.prank(merchant1);
        vm.expectRevert();
        settler.setMaxBatchSize(100);
    }

    function test_setMaxBatchSize_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit BatchSettler.MaxBatchSizeUpdated(50, 25);
        vm.prank(owner);
        settler.setMaxBatchSize(25);
    }

    // ─── Cross-Token: Revert without pool ────────────────────────────────────

    /// @notice Cross-token settlement without registered pool reverts.
    function test_executeBatch_revert_noPoolRegistered() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: merchant1,
            outputToken: address(eurc) // cross-token, but no pool registered
        });

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(BatchSettler.BatchSettler__NoPoolRegistered.selector, address(usdc), address(eurc))
        );
        settler.executeBatch(keccak256("batch-no-pool"), settlements, 0);
    }

    /// @notice validateBatch catches missing pool for cross-token settlement.
    function test_validateBatch_crossToken_noPool() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: 100e6, recipient: merchant1, outputToken: address(eurc)
        });

        (bool valid, uint256 errorIndex, string memory reason) = settler.validateBatch(settlements);
        assertFalse(valid);
        assertEq(errorIndex, 0);
        assertEq(reason, "No pool for token pair");
    }

    /// @notice outputToken == address(0) treated as same-token.
    function test_executeBatch_outputTokenZero_isSameToken() public {
        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), 100e6, keccak256("p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: 100e6,
            recipient: merchant1,
            outputToken: address(0) // treated as same-token
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("batch-zero-output"), settlements, 0);

        assertEq(usdc.balanceOf(merchant1), 100e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function testFuzz_executeBatch_singleSettlement_amountConsistency(uint256 amount) public {
        amount = bound(amount, 1, 100_000e6);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, keccak256("fuzz-p1"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: amount, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("fuzz-batch"), settlements, 0);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(merchant1), amount);
    }

    function testFuzz_executeBatch_partialSettlement_correctRemainder(uint256 depositAmount, uint256 settleAmount)
        public
    {
        depositAmount = bound(depositAmount, 2, 100_000e6);
        settleAmount = bound(settleAmount, 1, depositAmount);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), depositAmount, keccak256("fuzz-p2"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1,
            token: address(usdc),
            amount: settleAmount,
            recipient: merchant1,
            outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("fuzz-partial"), settlements, 0);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), depositAmount - settleAmount);
        assertEq(usdc.balanceOf(merchant1), settleAmount);
    }

    function testFuzz_executeBatch_feeCalculationCorrect(uint256 amount, uint256 bps) public {
        amount = bound(amount, 100, 100_000e6);
        bps = bound(bps, 1, 1000);

        vm.prank(owner);
        settler.setFeeConfig(owner, bps);

        vm.prank(payer);
        pool.receivePayment(merchant1, address(usdc), amount, keccak256("fuzz-fee"));

        BatchSettler.Settlement[] memory settlements = new BatchSettler.Settlement[](1);
        settlements[0] = BatchSettler.Settlement({
            merchant: merchant1, token: address(usdc), amount: amount, recipient: merchant1, outputToken: address(usdc)
        });

        vm.prank(owner);
        settler.executeBatch(keccak256("fuzz-fee-batch"), settlements, 0);

        uint256 expectedFee = (amount * bps) / 10000;
        uint256 expectedNet = amount - expectedFee;

        assertEq(usdc.balanceOf(merchant1), expectedNet);
        assertEq(usdc.balanceOf(owner), expectedFee);
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
    }
}
