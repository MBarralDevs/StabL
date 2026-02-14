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
        vm.expectRevert(IntentVault.IntentVault__ZeroAddress.selector);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, address(0));
    }

    /// @notice DEFERRED with zero minBatchAmount is rejected.
    function test_setIntent_revert_deferredNoThreshold() public {
        vm.prank(merchant1);
        vm.expectRevert(IntentVault.IntentVault__DeferredRequiresMinBatchAmount.selector);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 0, 0, USDC);
    }

    /// @notice STANDARD with zero maxWaitTime is rejected.
    function test_setIntent_revert_standardNoWaitTime() public {
        vm.prank(merchant1);
        vm.expectRevert(IntentVault.IntentVault__StandardRequiresMaxWaitTime.selector);
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

    // ─── Pausable ────────────────────────────────────────────────────────────

    /// @notice setIntent reverts when paused.
    function test_setIntent_revert_whenPaused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(merchant1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);
    }

    /// @notice deleteIntent still works when paused — merchants can always opt out.
    function test_deleteIntent_worksWhenPaused() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.prank(owner);
        vault.pause();

        vm.prank(merchant1);
        vault.deleteIntent();

        assertFalse(vault.hasIntent(merchant1));
    }

    /// @notice getIntent and hasIntent still work when paused.
    function test_viewFunctions_workWhenPaused() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.prank(owner);
        vault.pause();

        assertTrue(vault.hasIntent(merchant1));
        assertEq(vault.getIntent(merchant1).targetToken, USDC);
    }

    /// @notice Operations resume after unpausing.
    function test_unpause_resumesOperations() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(owner);
        vault.unpause();

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        assertTrue(vault.hasIntent(merchant1));
    }

    /// @notice Only owner can pause.
    function test_pause_revert_notOwner() public {
        vm.prank(merchant1);
        vm.expectRevert();
        vault.pause();
    }

    // ─── deleteIntent ────────────────────────────────────────────────────────

    /// @notice Merchant can delete their intent.
    function test_deleteIntent_basic() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        assertTrue(vault.hasIntent(merchant1));

        vm.prank(merchant1);
        vault.deleteIntent();

        assertFalse(vault.hasIntent(merchant1));
    }

    /// @notice Deleted intent resets all fields to zero.
    function test_deleteIntent_resetsAllFields() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, USDC);

        vm.prank(merchant1);
        vault.deleteIntent();

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.IMMEDIATE)); // enum default = 0
        assertEq(intent.minBatchAmount, 0);
        assertEq(intent.maxWaitTimeSeconds, 0);
        assertEq(intent.targetToken, address(0));
        assertFalse(intent.exists);
        assertEq(intent.updatedAt, 0);
    }

    /// @notice Deleting without an intent reverts.
    function test_deleteIntent_revert_noIntent() public {
        vm.prank(merchant1);
        vm.expectRevert(IntentVault.IntentVault__NoIntentToDelete.selector);
        vault.deleteIntent();
    }

    /// @notice Cannot delete the same intent twice.
    function test_deleteIntent_revert_alreadyDeleted() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.startPrank(merchant1);
        vault.deleteIntent();

        vm.expectRevert(IntentVault.IntentVault__NoIntentToDelete.selector);
        vault.deleteIntent();
        vm.stopPrank();
    }

    /// @notice Merchant can set a new intent after deleting.
    function test_deleteIntent_thenSetAgain() public {
        vm.startPrank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);
        vault.deleteIntent();
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 500e6, 0, EURC);
        vm.stopPrank();

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(intent.minBatchAmount, 500e6);
        assertEq(intent.targetToken, EURC);
        assertTrue(intent.exists);
    }

    /// @notice Deleting one merchant's intent doesn't affect another.
    function test_deleteIntent_isolatedBetweenMerchants() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, EURC);

        vm.prank(merchant1);
        vault.deleteIntent();

        assertFalse(vault.hasIntent(merchant1));
        assertTrue(vault.hasIntent(merchant2));
        assertEq(vault.getIntent(merchant2).minBatchAmount, 1000e6);
    }

    /// @notice deleteIntent emits event.
    function test_deleteIntent_emitsEvent() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.expectEmit(true, false, false, false);
        emit IntentVault.IntentDeleted(merchant1);

        vm.prank(merchant1);
        vault.deleteIntent();
    }

    // ─── updatedAt ───────────────────────────────────────────────────────────

    /// @notice updatedAt is set when intent is created.
    function test_setIntent_setsUpdatedAt() public {
        vm.warp(1000); // set block.timestamp to 1000

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        assertEq(vault.getIntent(merchant1).updatedAt, 1000);
    }

    /// @notice updatedAt changes when intent is updated.
    function test_setIntent_updatesUpdatedAt() public {
        vm.warp(1000);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.warp(2000);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 500e6, 0, EURC);

        assertEq(vault.getIntent(merchant1).updatedAt, 2000);
    }

    /// @notice updatedAt is zero for non-existent intent.
    function test_updatedAt_zeroWhenNoIntent() public view {
        assertEq(vault.getIntent(merchant1).updatedAt, 0);
    }

    /// @notice updatedAt resets to zero after delete.
    function test_updatedAt_resetsAfterDelete() public {
        vm.warp(1000);

        vm.startPrank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);
        vault.deleteIntent();
        vm.stopPrank();

        assertEq(vault.getIntent(merchant1).updatedAt, 0);
    }

    /// @notice updatedAt is fresh after delete + re-create.
    function test_updatedAt_freshAfterReCreate() public {
        vm.warp(1000);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.warp(5000);

        vm.startPrank(merchant1);
        vault.deleteIntent();
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, USDC);
        vm.stopPrank();

        assertEq(vault.getIntent(merchant1).updatedAt, 5000);
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
