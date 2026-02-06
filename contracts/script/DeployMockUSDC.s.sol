// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6); // Mint 1M USDC
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // Allow anyone to mint for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DeployMockUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        MockUSDC usdc = new MockUSDC();

        console.log("=================================================");
        console.log("Mock USDC deployed!");
        console.log("=================================================");
        console.log("Address:", address(usdc));
        console.log("Your balance:", usdc.balanceOf(msg.sender) / 1e6, "USDC");
        console.log("");
        console.log("Update your test scripts to use this address:");
        console.log("IERC20 usdc = IERC20(", address(usdc), ");");
        console.log("=================================================");

        vm.stopBroadcast();
    }
}
