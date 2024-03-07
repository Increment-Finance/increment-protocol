// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.15;

// contracts
import {PerpetualUtils} from "./helpers/PerpetualUtils.sol";
import {Test} from "forge-std/Test.sol";

// interfaces
import "../../contracts/interfaces/ICryptoSwap.sol";
import "../../contracts/interfaces/ICurveCryptoFactory.sol";
import "../../contracts/interfaces/IVault.sol";
import "../../contracts/interfaces/IVBase.sol";
import "../../contracts/interfaces/IVQuote.sol";
import "../../contracts/interfaces/IInsurance.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// libraries
import "../../contracts/lib/LibMath.sol";
import "../../contracts/lib/LibPerpetual.sol";

contract PerpetualTest is PerpetualUtils {
    using LibMath for int256;
    using LibMath for uint256;

    address liquidityProviderOne = address(123);
    address liquidityProviderTwo = address(456);
    address traderOne = address(789);

    function setUp() public virtual override {
        deal(liquidityProviderOne, 100 ether);
        deal(liquidityProviderTwo, 100 ether);
        deal(traderOne, 100 ether);

        super.setUp();
    }

    // run via source .env && forge test --match testScenario --fork-url $ETH_NODE_URI_MAINNET --fork-block-number $BLOCK_NUMBER -vvvvv
    function testScenario(uint256 providedLiquidity, uint256 tradeAmount) public {
        /* bounds */
        providedLiquidity = bound(providedLiquidity, 100e18, 10_000e18);
        tradeAmount = bound(tradeAmount, 100e18, 1_000e18);
        require(providedLiquidity >= 100e18 && providedLiquidity <= 10_000e18);
        require(tradeAmount >= 100e18 && tradeAmount <= 1_000e18);

        // initial liquidity
        fundAndPrepareAccount(liquidityProviderOne, 100_000e18, vault, ua);
        _provideLiquidity(10_000e18, liquidityProviderOne);

        // provide some more liquidity
        fundAndPrepareAccount(liquidityProviderTwo, providedLiquidity, vault, ua);
        _provideLiquidity(providedLiquidity, liquidityProviderTwo);

        // skip some time
        skip(perpetual.lockPeriod());

        // open a position
        fundAndPrepareAccount(traderOne, tradeAmount, vault, ua);
        _openPosition(tradeAmount, traderOne);

        // remove liquidity
        _removeAllLiquidity(liquidityProviderTwo);

        // close the position
        _closePosition(traderOne);

        // trader balance
        uint256 balanceTrader = ua.balanceOf(traderOne);
        uint256 balanceLp = ua.balanceOf(liquidityProviderTwo);

        assertTrue(balanceTrader + balanceLp < providedLiquidity + tradeAmount);
    }

    // STATUS: can not use debugger since this happens: https://github.com/foundry-rs/foundry/issues/2143
}
