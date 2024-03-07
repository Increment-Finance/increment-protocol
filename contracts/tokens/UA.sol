// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {BaseERC20} from "./BaseERC20.sol";
import {IncreAccessControl} from "../utils/IncreAccessControl.sol";

// interfaces
import {IUA} from "../interfaces/IUA.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LibMath} from "../lib/LibMath.sol";
import {LibReserve} from "../lib/LibReserve.sol";

/// @notice Unit of Account (UA) is a USDC-backed token used as the unit of account accross Increment
contract UA is IUA, BaseERC20, IncreAccessControl {
    using SafeERC20 for IERC20Metadata;
    using LibMath for int256;
    using LibMath for uint256;

    ReserveToken[] public reserveTokens;

    constructor(IERC20Metadata initialReserveToken, uint256 initialTokenMaxMintCap)
        BaseERC20("Increment Unit of Account", "UA")
    {
        addReserveToken(initialReserveToken, initialTokenMaxMintCap);
    }

    /* ************************* */
    /*   Reserve operations      */
    /* ************************* */

    /// @notice Mint UA with USDC, 1:1 backed
    /// @param tokenIdx Index of token white listed reserve token to add to the protocol
    /// @param amount Amount of reserve token. Might not be 18 decimals
    function mintWithReserve(uint256 tokenIdx, uint256 amount) external override {
        // Check that the reserve token is supported
        if (tokenIdx > reserveTokens.length - 1) revert UA_InvalidReserveTokenIndex();
        ReserveToken memory reserveToken = reserveTokens[tokenIdx];

        // Check that the cap of the reserve token isn't reached
        uint256 wadAmount = LibReserve.tokenToWad(reserveToken.asset.decimals(), amount);
        if (reserveToken.currentReserves + wadAmount > reserveToken.mintCap) revert UA_ExcessiveTokenMintCapReached();

        _mint(msg.sender, wadAmount);
        reserveTokens[tokenIdx].currentReserves += wadAmount;

        reserveToken.asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Burn UA in exchange of USDC
    /// @param tokenIdx Index of token white listed reserve token to add to the protocol
    /// @param amount UA amount. 18 decimals
    function withdraw(uint256 tokenIdx, uint256 amount) external override {
        // Check that the reserve token is supported
        if (tokenIdx > reserveTokens.length - 1) revert UA_InvalidReserveTokenIndex();
        IERC20Metadata reserveTokenAsset = reserveTokens[tokenIdx].asset;

        _burn(msg.sender, amount);
        reserveTokens[tokenIdx].currentReserves -= amount;

        uint256 tokenAmount = LibReserve.wadToToken(reserveTokenAsset.decimals(), amount);
        reserveTokenAsset.safeTransfer(msg.sender, tokenAmount);
    }

    /* ****************** */
    /*     Governance     */
    /* ****************** */

    function addReserveToken(IERC20Metadata newReserveToken, uint256 tokenMintCap)
        public
        override
        onlyRole(GOVERNANCE)
    {
        if (address(newReserveToken) == address(0)) revert UA_ReserveTokenZeroAddress();

        for (uint256 i = 0; i < reserveTokens.length; i++) {
            if (reserveTokens[i].asset == newReserveToken) revert UA_ReserveTokenAlreadyAssigned();
        }

        reserveTokens.push(ReserveToken({asset: newReserveToken, currentReserves: 0, mintCap: tokenMintCap}));

        emit ReserveTokenAdded(newReserveToken, reserveTokens.length);
    }

    function changeReserveTokenMaxMintCap(uint256 tokenIdx, uint256 newMintCap) external override onlyRole(GOVERNANCE) {
        // Check that the reserve token is one of the white listed tokens
        if (tokenIdx > reserveTokens.length - 1) revert UA_InvalidReserveTokenIndex();

        reserveTokens[tokenIdx].mintCap = newMintCap;
        emit ReserveTokenMaxMintCapUpdated(reserveTokens[tokenIdx].asset, newMintCap);
    }

    /* *********** */
    /*   Viewer    */
    /* *********** */

    /// @notice Return the number of reserve tokens
    /// @return Number of reserve tokens
    function getNumReserveTokens() external view override returns (uint256) {
        return reserveTokens.length;
    }
}
