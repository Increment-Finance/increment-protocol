// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.15;

// contracts
import {Deployment} from "./Deployment.sol";
import {Utils} from "./Utils.sol";

// interfaces
import "../../../contracts/interfaces/ICryptoSwap.sol";
import "../../../contracts/interfaces/ICurveCryptoFactory.sol";
import "../../../contracts/interfaces/IVault.sol";
import "../../../contracts/interfaces/IVBase.sol";
import "../../../contracts/interfaces/IVQuote.sol";
import "../../../contracts/interfaces/IInsurance.sol";
import "../../../contracts/interfaces/ICurveCryptoViews.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import "../../../contracts/lib/LibMath.sol";
import "../../../contracts/lib/LibPerpetual.sol";
import "../../../contracts/lib/LibMath.sol";

// utils
import {StorageAccessible} from "util-contracts/storage/StorageAccessible.sol";

abstract contract PerpetualUtils is Deployment, Utils, StorageAccessible {
    using LibMath for int256;
    using LibMath for uint256;

    /* ****************** */
    /*  USER OPERATIONS   */
    /* ****************** */

    function _provideLiquidity(uint256 quoteAmount, address user) internal {
        changePrank(user);

        clearingHouse.deposit(quoteAmount, ua);
        uint256 baseAmount = quoteAmount.wadDiv(perpetual.indexPrice().toUint256());
        clearingHouse.provideLiquidity(0, [quoteAmount, baseAmount], 0);
    }

    function _removeAllLiquidity(address user) internal {
        changePrank(user);

        uint256 proposedAmount = _getLiquidityProviderProposedAmount(user);
        /*
        according to curve v2 whitepaper:
        discard values that do not converge
        */
        vm.assume(proposedAmount > 1e17);

        clearingHouse.removeLiquidity(
            0,
            perpetual.getLpPosition(user).liquidityBalance,
            [uint256(0), uint256(0)],
            proposedAmount,
            0
        );

        clearingHouse.withdrawAll(ua);
    }

    function _openPosition(uint256 amount, address user) internal {
        changePrank(user);

        clearingHouse.deposit(amount, ua);
        clearingHouse.changePosition(0, amount, 0, LibPerpetual.Side.Long);
    }

    function _closePosition(address user) internal {
        changePrank(user);

        uint256 proposedAmount = _getTraderProposedAmount(user);

        LibPerpetual.Side direction = perpetual.getTraderPosition(user).positionSize > 0
            ? LibPerpetual.Side.Short
            : LibPerpetual.Side.Long;
        clearingHouse.changePosition(0, proposedAmount, 0, direction);

        clearingHouse.withdrawAll(ua);
    }

    /* ****************** */
    /*  USER HELPERS      */
    /* ****************** */

    function _getTraderProposedAmount(address user) internal returns (uint256 proposedAmount) {
        LibPerpetual.TraderPosition memory trader = perpetual.getTraderPosition(user);
        if (trader.openNotional == 0) revert("No position open");

        /* The following simulate call will delegate call the perpetual contract
        in the context of the PerpetualTest contract. That means we have to fund the
        PerpetualTest contract with the relevant funds to perform all necessary token transfers
        with the CryptoSwap contract. */
        changePrank(address(this));

        // increase token balances / do not increase total supply
        deal(address(vQuote), address(this), 10000 ether, false);
        vQuote.approve(address(cryptoSwap), type(uint256).max);

        changePrank(user);

        /* start simulation */
        int256 targetPositionSize = trader.positionSize;

        return
            _getProposedAmount(
                targetPositionSize,
                LibPerpetual.LiquidityProviderPosition(0, 0, 0, 0, 0, 0, 0, 0),
                _simulateTrader
            );
    }

    function _getLiquidityProviderProposedAmount(address user) internal returns (uint256 proposedAmount) {
        LibPerpetual.LiquidityProviderPosition memory lp = perpetual.getLpPosition(user);
        if (lp.liquidityBalance == 0) revert("No liquidity provided");

        /* The following simulate call will delegate call the perpetual contract
        in the context of the PerpetualTest contract. That means we have to fund the
        PerpetualTest contract with the relevant funds to perform all necessary token transfers
        with the CryptoSwap contract. */
        changePrank(address(this));

        // increase token balances / do not increase total supply
        deal(address(lpToken), address(this), 10000 ether, false);
        deal(address(vQuote), address(this), 10000 ether, false);
        vQuote.approve(address(cryptoSwap), type(uint256).max);

        changePrank(user);

        /* start simulation */

        LibPerpetual.TraderPosition memory activePosition = perpetual.getLpPositionAfterWithdrawal(user);
        int256 targetPositionSize = activePosition.positionSize;

        return _getProposedAmount(targetPositionSize, lp, _simulateLp);
    }

    function _getProposedAmount(
        int256 targetPositionSize,
        LibPerpetual.LiquidityProviderPosition memory lp,
        function(uint256, LibPerpetual.LiquidityProviderPosition memory) returns (uint256) simulate
    ) internal returns (uint256 proposedAmount) {
        {
            if (targetPositionSize > 0) {
                proposedAmount = targetPositionSize.toUint256();
            } else {
                uint256 position = (-targetPositionSize).toUint256();
                proposedAmount = position.wadMul(perpetual.marketPrice());

                // binary search in [marketPrice * 0.7, marketPrice * 1.3]
                uint256 maxVal = (proposedAmount * 13) / 10;
                uint256 minVal = (proposedAmount * 7) / 10;
                uint256 baseProceeds;

                for (
                    uint256 i = 0;
                    i < 100; /* hardcode to avoid stack to deep */
                    i++
                ) {
                    proposedAmount = (minVal + maxVal) / 2;
                    baseProceeds = simulate(proposedAmount, lp);
                    if (baseProceeds == position) {
                        break;
                    } else if (baseProceeds < position) {
                        minVal = proposedAmount;
                    } else {
                        maxVal = proposedAmount;
                    }
                }

                // take maxVal to make sure we are above the target
                if (baseProceeds < position) {
                    proposedAmount = maxVal;
                    baseProceeds = simulate(proposedAmount, lp);
                }
            }
        }
    }

    /* ****************** */
    /*  SIMULATIONS       */
    /* ****************** */

    function _simulateLp(uint256 proposedAmount, LibPerpetual.LiquidityProviderPosition memory lp)
        internal
        returns (uint256 baseProceeds)
    {
        uint256 totalBaseFeesGrowth = (perpetual.getGlobalPosition()).totalBaseFeesGrowth;

        (, baseProceeds) = abi.decode(
            this.simulate(
                address(perpetual),
                abi.encodeWithSelector(
                    this.__TestPerpetual_remove_liquidity_swap.selector,
                    address(cryptoSwap),
                    address(curveCryptoViews),
                    address(vBase),
                    lp.liquidityBalance,
                    totalBaseFeesGrowth,
                    lp.totalBaseFeesGrowth,
                    proposedAmount
                )
            ),
            (uint256, uint256)
        );

        return baseProceeds;
    }

    function _simulateTrader(uint256 proposedAmount, LibPerpetual.LiquidityProviderPosition memory)
        internal
        returns (uint256 baseProceeds)
    {
        baseProceeds = abi.decode(
            this.simulate(
                address(perpetual),
                abi.encodeWithSelector(
                    this.__TestPerpetual__quoteForBase.selector,
                    address(cryptoSwap),
                    address(curveCryptoViews),
                    proposedAmount
                )
            ),
            (uint256)
        );

        return baseProceeds;
    }

    /* EMPTY SHELL CONTRACT USED TO FOR SIMULATIONS. Their implementation is in TestPerpetual */
    function __TestPerpetual__quoteForBase(
        ICryptoSwap _market,
        ICurveCryptoViews _views,
        uint256 quoteAmount
    ) public returns (uint256 vBaseAdjusted) {}

    function __TestPerpetual_remove_liquidity_swap(
        ICryptoSwap market_,
        ICurveCryptoViews views_,
        IVBase vBase_,
        uint256 liquidityAmountToRemove,
        uint256 globalTotalBaseFeesGrowth,
        uint256 lpTotalBaseFeesGrowth,
        uint256 proposedAmount
    ) public returns (uint256 baseAmountRemoved, uint256 baseProceeds) {}
}
