// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vault} from "../Vault.sol";

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import {LibReserve} from "../lib/LibReserve.sol";

/*
 * TestVault includes some setter functions to edit part of
 * the internal state of Vault which aren't exposed otherwise.
 */
contract TestVault is Vault {
    using SafeERC20 for IERC20Metadata;

    constructor(IERC20Metadata _ua) Vault(_ua) {}

    function __TestVault_getUserReserveValue(address user, bool isDiscounted) external view returns (int256) {
        return _getUserReserveValue(user, isDiscounted);
    }

    /// @notice Set trader balance without any actual token transfer
    function __TestVault_change_trader_balance(
        address user,
        uint256 tokenIdx,
        int256 amount
    ) external {
        return _changeBalance(user, tokenIdx, amount);
    }

    /// @notice Set lp balance without any actual token transfer
    function __TestVault_change_lp_balance(
        address user,
        uint256 tokenIdx,
        int256 amount
    ) external {
        return _changeBalance(user, tokenIdx, amount);
    }

    /// @notice Empty out the vault without adjusting the internal user accounting
    function __TestVault_transfer_out(
        address user,
        IERC20Metadata withdrawToken,
        uint256 amount // 1e18
    ) external {
        // get asset
        uint256 tokenIdx = tokenToCollateralIdx[withdrawToken];

        // adjust global balances
        whiteListedCollaterals[tokenIdx].currentAmount -= amount;

        // withdraw
        uint256 tokenAmount = LibReserve.wadToToken(whiteListedCollaterals[tokenIdx].decimals, amount);
        IERC20Metadata(withdrawToken).safeTransfer(user, tokenAmount);
    }

    function __TestVault_getUndiscountedCollateralUSDValue(IERC20Metadata collateralAsset, int256 collateralBalance)
        external
        view
        returns (int256)
    {
        return _getUndiscountedCollateralUSDValue(collateralAsset, collateralBalance);
    }
}
