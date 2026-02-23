// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.19;

/// @title HookMiner - a library for mining hook addresses
/// @dev This library is intended for `forge test` environments. It finds a salt
///      that produces a hook address with the desired permission flags.
library HookMiner {
    uint160 constant FLAG_MASK = uint160(0x3FFF);

    uint256 constant MAX_LOOP = 100_000;

    /// @notice Find a salt that produces a hook address with the desired `flags`
    /// @param deployer The address that will deploy the hook (address(this) in tests)
    /// @param flags The desired flags for the hook address
    /// @param seed Use 0 as default. Starting salt for the search.
    /// @param creationCode The creation code of the hook contract
    /// @param constructorArgs The abi-encoded constructor arguments
    /// @return hookAddress The address that was found
    /// @return salt The salt that produces the hookAddress
    function find(
        address deployer,
        uint160 flags,
        uint256 seed,
        bytes memory creationCode,
        bytes memory constructorArgs
    ) external pure returns (address hookAddress, bytes32 salt) {
        bytes memory creationCodeWithArgs = abi.encodePacked(creationCode, constructorArgs);

        for (uint256 i = seed; i < seed + MAX_LOOP; i++) {
            bytes32 _salt = bytes32(i);
            hookAddress = computeAddress(deployer, _salt, creationCodeWithArgs);
            if (uint160(hookAddress) & FLAG_MASK == flags) {
                return (hookAddress, _salt);
            }
        }
        revert("HookMiner: could not find salt");
    }

    function computeAddress(address deployer, bytes32 salt, bytes memory creationCode) internal pure returns (address) {
        return
            address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, keccak256(creationCode)))))
            );
    }
}
