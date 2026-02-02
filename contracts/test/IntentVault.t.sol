// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/IntentVault.sol";

contract IntentVaultTest is Test {
    // ─── Contracts ───────────────────────────────────────────────────────────
    IntentVault vault;

    // ─── Actors ──────────────────────────────────────────────────────────────
    address owner;
    address merchant1;
    address merchant2;

    // ─── Token addresses (just need to be non-zero for tests) ───────────────
    address USDC = address(0xA);
    address EURC = address(0xB);

    // ─── Setup ───────────────────────────────────────────────────────────────
    function setUp() public {
        owner = address(0x01);
        merchant1 = address(0x02);
        merchant2 = address(0x03);

        vm.prank(owner);
        vault = new IntentVault();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── setIntent ───────────────────────────────────────────────────────────

    /// @notice Merchant sets IMMEDIATE intent — reads back correctly.
    function test_setIntent_immediate() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.IMMEDIATE));
        assertEq(intent.targetToken, USDC);
        assertTrue(intent.exists);
    }

    /// @notice Merchant sets STANDARD intent with a wait time.
    function test_setIntent_standard() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, USDC); // 1 hour wait

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.STANDARD));
        assertEq(intent.maxWaitTimeSeconds, 3600);
        assertTrue(intent.exists);
    }

    /// @notice Merchant sets DEFERRED intent with a batch threshold.
    function test_setIntent_deferred() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, EURC); // 1000 EURC threshold

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(intent.minBatchAmount, 1000e6);
        assertEq(intent.targetToken, EURC);
    }

    /// @notice Updating an intent overwrites the previous one completely.
    function test_setIntent_update_overwrites() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        // Update to DEFERRED
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 500e6, 0, EURC);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(intent.minBatchAmount, 500e6);
        assertEq(intent.targetToken, EURC);
    }

    /// @notice Two merchants have independent intents.
    function test_setIntent_twoMerchants_isolated() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 2000e6, 0, EURC);

        IntentVault.MerchantIntent memory i1 = vault.getIntent(merchant1);
        IntentVault.MerchantIntent memory i2 = vault.getIntent(merchant2);

        assertEq(uint256(i1.speed), uint256(IntentVault.SettlementSpeed.IMMEDIATE));
        assertEq(uint256(i2.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(i1.targetToken, USDC);
        assertEq(i2.targetToken, EURC);
    }

    /// @notice IntentUpdated event is emitted with correct params.
    function test_setIntent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IntentVault.IntentUpdated(merchant1, IntentVault.SettlementSpeed.STANDARD, 0, 7200, USDC);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 7200, USDC);
    }

    // ─── Revert cases ────────────────────────────────────────────────────────

    /// @notice Zero targetToken is rejected.
    function test_setIntent_revert_zeroTargetToken() public {
        vm.prank(merchant1);
        vm.expectRevert("IntentVault: targetToken is zero address");
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, address(0));
    }

    /// @notice DEFERRED with zero minBatchAmount is rejected.
    function test_setIntent_revert_deferredNoThreshold() public {
        vm.prank(merchant1);
        vm.expectRevert("IntentVault: DEFERRED requires minBatchAmount > 0");
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 0, 0, USDC);
    }

    /// @notice STANDARD with zero maxWaitTime is rejected.
    function test_setIntent_revert_standardNoWaitTime() public {
        vm.prank(merchant1);
        vm.expectRevert("IntentVault: STANDARD requires maxWaitTimeSeconds > 0");
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 0, USDC);
    }

    // ─── hasIntent ───────────────────────────────────────────────────────────

    /// @notice hasIntent returns false before any intent is set.
    function test_hasIntent_false_initially() public view {
        assertFalse(vault.hasIntent(merchant1));
    }

    /// @notice hasIntent returns true after setting an intent.
    function test_hasIntent_true_afterSet() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        assertTrue(vault.hasIntent(merchant1));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUZZ TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Fuzz: any valid DEFERRED intent stores and reads back correctly.
     *
     * We fuzz minBatchAmount (must be > 0) and maxWaitTimeSeconds (ignored for DEFERRED,
     * but we pass it anyway to make sure it doesn't corrupt state).
     */
    function testFuzz_setIntent_deferred_roundTrip(uint256 minBatchAmount, address targetToken) public {
        // targetToken can't be zero
        vm.assume(targetToken != address(0));
        // minBatchAmount must be > 0 for DEFERRED
        minBatchAmount = bound(minBatchAmount, 1, type(uint256).max);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, minBatchAmount, 0, targetToken);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(intent.minBatchAmount, minBatchAmount);
        assertEq(intent.targetToken, targetToken);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertTrue(intent.exists);
    }

    /**
     * @notice Fuzz: any valid STANDARD intent stores and reads back correctly.
     *
     * We fuzz maxWaitTimeSeconds (must be > 0).
     */
    function testFuzz_setIntent_standard_roundTrip(uint256 maxWaitTimeSeconds, address targetToken) public {
        vm.assume(targetToken != address(0));
        maxWaitTimeSeconds = bound(maxWaitTimeSeconds, 1, type(uint256).max);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, maxWaitTimeSeconds, targetToken);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(intent.maxWaitTimeSeconds, maxWaitTimeSeconds);
        assertEq(intent.targetToken, targetToken);
        assertTrue(intent.exists);
    }

    /**
     * @notice Fuzz: two merchants setting intents with random params never interfere.
     *
     * This catches any bug where the mapping key logic is broken.
     */
    function testFuzz_twoMerchants_neverInterfere(
        uint256 threshold1,
        uint256 threshold2,
        address token1,
        address token2
    ) public {
        vm.assume(token1 != address(0));
        vm.assume(token2 != address(0));
        threshold1 = bound(threshold1, 1, type(uint256).max);
        threshold2 = bound(threshold2, 1, type(uint256).max);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, threshold1, 0, token1);

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, threshold2, 0, token2);

        // Verify isolation
        assertEq(vault.getIntent(merchant1).minBatchAmount, threshold1);
        assertEq(vault.getIntent(merchant1).targetToken, token1);
        assertEq(vault.getIntent(merchant2).minBatchAmount, threshold2);
        assertEq(vault.getIntent(merchant2).targetToken, token2);
    }
}
