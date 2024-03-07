// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity >=0.8.0;

// contracts
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract TestERC4626 is ERC4626 {
    constructor(
        string memory name_,
        string memory symbol_,
        IERC20Metadata asset_
    ) ERC20(name_, symbol_) ERC4626(asset_) {}
}
