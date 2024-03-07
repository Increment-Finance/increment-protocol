// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// interfaces
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IUA is IERC20Metadata {
    struct ReserveToken {
        IERC20Metadata asset;
        uint256 currentReserves; // 18 decimals
        uint256 mintCap; // 18 decimals
    }

    /* ****************** */
    /*     Errors         */
    /* ****************** */

    /// @notice Emitted when the proposed reserve token address is equal to the zero address
    error UA_ReserveTokenZeroAddress();

    /// @notice Emitted when the proposed reserve token index doesn't match any index in the reserve token list
    error UA_InvalidReserveTokenIndex();

    /// @notice Emitted when the proposed reserve token is already registered
    error UA_ReserveTokenAlreadyAssigned();

    /// @notice Emitted when the UA amount to mint with the token exceed the max cap of this token
    error UA_ExcessiveTokenMintCapReached();

    /* ****************** */
    /*     Events         */
    /* ****************** */

    /// @notice Emitted when new reserve token is added
    /// @param newToken New reserve token
    /// @param numReserveTokens Number of reserve tokens
    event ReserveTokenAdded(IERC20Metadata indexed newToken, uint256 numReserveTokens);

    /// @notice Emitted when the max mint cap of a reserve token is updated
    /// @param token Token to update
    /// @param neMintCap New max mint cap
    event ReserveTokenMaxMintCapUpdated(IERC20Metadata indexed token, uint256 neMintCap);

    /* ******************* */
    /*  Reserve operations */
    /* ******************* */

    function mintWithReserve(uint256 tokenIdx, uint256 amount) external;

    function withdraw(uint256 tokenIdx, uint256 amount) external;

    /* ****************** */
    /*     Governance     */
    /* ****************** */

    function addReserveToken(IERC20Metadata newReserveToken, uint256 tokenMintCap) external;

    function changeReserveTokenMaxMintCap(uint256 tokenIdx, uint256 newMintCap) external;

    /* *********** */
    /*   Viewer    */
    /* *********** */

    function getNumReserveTokens() external view returns (uint256);
}
