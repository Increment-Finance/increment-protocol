import {User} from './setup';
import env from 'hardhat';

import {LibPerpetual} from '../../typechain/contracts/Perpetual';
import {CurveCryptoSwap2ETH} from '../../typechain';

import {BigNumber, BigNumberish} from 'ethers';

import {VQUOTE_INDEX, VBASE_INDEX, WAD} from '../../helpers/constants';
import {rDiv, rMul} from './utils/calculations';
import {
  fundAccountsHardhat,
  impersonateAccountsHardhat,
  setupUser,
} from '../../helpers/misc-utils';

import {
  getGlobalPosition,
  getMarket,
  getPerpetual,
  getTotalSupply,
} from './PerpetualGetters';
import {getFundingPayment, getFundingRate} from './FundingGetters';
import {getCloseProposedAmount, _getPnl} from './TradingGetters';
import {parseEther} from 'ethers/lib/utils';

/* ********************************* */
/*   Liquidity providers profit      */
/* ********************************* */

export async function getLpProfit(
  user: User,
  currentTime: BigNumber,
  marketIdx: BigNumberish = 0,
  isLiquidation = false // liquidation does not charge insurance fees
): Promise<BigNumber> {
  const snapshotId = await env.network.provider.send('evm_snapshot', []);

  const pnL = await getLpPnL(user, marketIdx, isLiquidation);

  const funding = await getLpFunding(user, currentTime, marketIdx);

  const earnedTradingFees = await getLpTradingFees(user, marketIdx);

  await env.network.provider.send('evm_revert', [snapshotId]);
  return pnL.add(funding).add(earnedTradingFees);
}

export async function getLpPnL(
  user: User,
  marketIdx: BigNumberish = 0,
  isLiquidation = false // liquidation does not charge insurance fees
): Promise<BigNumber> {
  const market = await getMarket(user, marketIdx);
  const perpetual = await getPerpetual(user, marketIdx);

  const lpPositionBeforeWithdrawal =
    await user.clearingHouseViewer.getLpPosition(marketIdx, user.address);

  const lpPositionAfterWithdrawal = await getLpPositionAfterWithdrawal(
    lpPositionBeforeWithdrawal,
    await getGlobalPosition(user, marketIdx),
    market
  );

  /* simulate slippage after liquidity is removed */
  const snapshotId = await env.network.provider.send('evm_snapshot', []);

  await impersonateAccountsHardhat([perpetual.address], env);
  await fundAccountsHardhat([perpetual.address], env);
  const perpetualAccount = await setupUser(perpetual.address, {
    market: market,
  });

  await perpetualAccount.market['remove_liquidity(uint256,uint256[2])'](
    lpPositionBeforeWithdrawal.liquidityBalance,
    [0, 0]
  );

  const {pnl, quoteProceeds} = await _getPnl(
    lpPositionAfterWithdrawal,
    market,
    user.curveViews
  );

  const insuranceFee = rMul(
    quoteProceeds.abs(),
    await perpetual.insuranceFee()
  );
  const profit = isLiquidation ? pnl : pnl.sub(insuranceFee);

  await env.network.provider.send('evm_revert', [snapshotId]);
  /* simulate slippage after liquidity is removed */

  return profit;
}

export async function getLpFunding(
  user: User,
  currentTime: BigNumber,
  marketIdx: BigNumberish = 0
): Promise<BigNumber> {
  const perpetual = await getPerpetual(user, marketIdx);
  const market = await getMarket(user, marketIdx);

  const globalPosition = await user.clearingHouseViewer.getGlobalPosition(
    marketIdx
  );

  const fundingRate = await getFundingRate(
    perpetual,
    globalPosition,
    currentTime
  );

  const lpPositionBeforeWithdrawal =
    await user.clearingHouseViewer.getLpPosition(marketIdx, user.address);

  const lpPositionAfterWithdrawal = await getLpPositionAfterWithdrawal(
    lpPositionBeforeWithdrawal,
    await getGlobalPosition(user, marketIdx),
    market
  );

  const fundingPayments = await getFundingPayment(
    fundingRate,
    lpPositionAfterWithdrawal
  );

  return fundingPayments;
}

export async function getLpTradingFees(
  user: User,
  marketIdx: BigNumberish
): Promise<BigNumber> {
  const globalPosition = await user.clearingHouseViewer.getGlobalPosition(
    marketIdx
  );

  const lpPosition = await user.clearingHouseViewer.getLpPosition(
    marketIdx,
    user.address
  );

  const tradingFees = rMul(
    globalPosition.totalTradingFeesGrowth.sub(
      lpPosition.totalTradingFeesGrowth
    ),
    lpPosition.openNotional.abs()
  );

  return tradingFees;
}

/* ********************************* */
/*   Liquidity providers utils       */
/* ********************************* */

export async function getLiquidityProviderProposedAmount(
  user: User,
  userLpPositionBefore: LibPerpetual.LiquidityProviderPositionStructOutput,
  liquidityAmountToRemove: BigNumber = userLpPositionBefore.liquidityBalance,
  marketIdx: BigNumberish = 0
): Promise<BigNumber> {
  const market = await getMarket(user, marketIdx);

  const reductionRatio = rDiv(
    liquidityAmountToRemove,
    userLpPositionBefore.liquidityBalance
  );

  const lpPositionToClose =
    liquidityAmountToRemove == userLpPositionBefore.liquidityBalance
      ? userLpPositionBefore
      : ({
          liquidityBalance: <BigNumber>liquidityAmountToRemove,
          positionSize: <BigNumber>(
            rMul(userLpPositionBefore.positionSize, reductionRatio)
          ),
          openNotional: <BigNumber>(
            rMul(userLpPositionBefore.openNotional, reductionRatio)
          ),
          cumFundingRate: <BigNumber>userLpPositionBefore.cumFundingRate,
          totalBaseFeesGrowth: <BigNumber>(
            userLpPositionBefore.totalBaseFeesGrowth
          ),
          totalQuoteFeesGrowth: <BigNumber>(
            userLpPositionBefore.totalQuoteFeesGrowth
          ),
          totalTradingFeesGrowth: <BigNumber>(
            userLpPositionBefore.totalTradingFeesGrowth
          ),
        } as LibPerpetual.LiquidityProviderPositionStructOutput);

  const userLpPositionAfter = await getLpPositionAfterWithdrawal(
    lpPositionToClose,
    await getGlobalPosition(user, marketIdx),
    market
  );

  const snapshotId = await env.network.provider.send('evm_snapshot', []);

  /* simulate slippage after liquidity is removed */
  await removeLiquidityFromPool(
    user,
    lpPositionToClose.liquidityBalance,
    marketIdx
  );

  const proposedAmount = await getCloseProposedAmount(
    userLpPositionAfter,
    market,
    user.curveViews
  );

  await env.network.provider.send('evm_revert', [snapshotId]);
  /* simulate slippage after liquidity is removed */
  return proposedAmount;
}

// @dev set minVariance to keep looping until base proceeds is within minVariance of proposedAmount
export async function getLiquidityProviderProposedAmountContract(
  user: User,
  lpPositionAfterWithdrawal: LibPerpetual.TraderPositionStructOutput,
  minVTokenAmounts: [BigNumber, BigNumber],
  liquidityAmountToRemove: BigNumber,
  minVariance: BigNumberish = 0
): Promise<BigNumber> {
  // if isLong, proposedAmount = positionSize
  if (lpPositionAfterWithdrawal.positionSize.gte(0)) {
    return lpPositionAfterWithdrawal.positionSize;
  }

  let eProposedAmount = rMul(
    lpPositionAfterWithdrawal.positionSize.abs(),
    await user.perpetual.indexPrice()
  );
  let baseProceeds = '0';
  let minProposedAmount = rMul(eProposedAmount, parseEther('0.5'));
  let maxProposedAmount = rMul(eProposedAmount, parseEther('1.5'));

  // binary search for best proposedAmount
  while (
    lpPositionAfterWithdrawal.positionSize
      .abs()
      .sub(baseProceeds)
      .abs()
      .gt(minVariance)
  ) {
    if (baseProceeds !== '0') {
      if (lpPositionAfterWithdrawal.positionSize.abs().gt(baseProceeds)) {
        const diff = maxProposedAmount.sub(eProposedAmount);
        minProposedAmount = eProposedAmount;
        eProposedAmount = eProposedAmount.add(diff.div(2));
      } else if (
        lpPositionAfterWithdrawal.positionSize.abs().lt(baseProceeds)
      ) {
        const diff = eProposedAmount.sub(minProposedAmount);
        maxProposedAmount = eProposedAmount;
        eProposedAmount = eProposedAmount.sub(diff.div(2));
      } else {
        break;
      }
    }
    // Update baseProceeds
    baseProceeds = (
      await user.clearingHouseViewer.callStatic.removeLiquiditySwap(
        '0',
        user.address,
        liquidityAmountToRemove,
        minVTokenAmounts,
        eProposedAmount
      )
    ).toString();
  }

  return eProposedAmount;
}

/// @dev Remove liquidity from cryptoswap pool
/// @dev Used to simulated the slippage after liquidity is removed
export async function removeLiquidityFromPool(
  user: User,
  liquidity: BigNumber,
  marketIdx: BigNumberish = 0
): Promise<void> {
  const perpetual = await getPerpetual(user, marketIdx);
  const market = await getMarket(user, marketIdx);

  await impersonateAccountsHardhat([perpetual.address], env);
  await fundAccountsHardhat([perpetual.address], env);
  const perpetualAccount = await setupUser(perpetual.address, {
    market: market,
  });

  await perpetualAccount.market['remove_liquidity(uint256,uint256[2])'](
    liquidity,
    [0, 0]
  );
}

export async function getLpPositionAfterWithdrawal(
  position: LibPerpetual.LiquidityProviderPositionStructOutput,
  global: LibPerpetual.GlobalPositionStructOutput,
  market: CurveCryptoSwap2ETH
): Promise<LibPerpetual.TraderPositionStructOutput> {
  // total supply of lp tokens

  // withdrawable amount: balance * share of lp tokens (lpTokensOwned / lpTotalSupply) - 1 (favors existing LPs)
  /*
    for reference:
    https://github.com/Increment-Finance/increment-protocol/blob/c405099de6fddd6b0eeae56be674c00ee4015fc5/contracts-vyper/contracts/CurveCryptoSwap2ETH.vy#L1013
    */

  const tokensAfterWithdrawal = await getTokensToWithdraw(
    position,
    global,
    market
  );
  const lpPositionAfterWithdrawal: LibPerpetual.TraderPositionStructOutput = {
    positionSize: <BigNumber>(
      position.positionSize.add(tokensAfterWithdrawal.withdrawnBaseTokensExFees)
    ),
    openNotional: <BigNumber>(
      position.openNotional.add(
        tokensAfterWithdrawal.withdrawnQuoteTokensExFees
      )
    ),
    cumFundingRate: <BigNumber>position.cumFundingRate,
  } as LibPerpetual.TraderPositionStructOutput;

  return lpPositionAfterWithdrawal;
}

export async function getTokensToWithdraw(
  position: LibPerpetual.LiquidityProviderPositionStructOutput,
  global: LibPerpetual.GlobalPositionStructOutput,
  market: CurveCryptoSwap2ETH
): Promise<{
  withdrawnBaseTokens: BigNumber;
  withdrawnQuoteTokens: BigNumber;
  withdrawnBaseTokensExFees: BigNumber;
  withdrawnQuoteTokensExFees: BigNumber;
}> {
  const lpTotalSupply = await getTotalSupply(market);
  const lpTokenToWithdraw = position.liquidityBalance;

  // share of tokens withdrawn
  const withdrawnQuoteTokens = (await market.balances(VQUOTE_INDEX))
    .mul(lpTokenToWithdraw)
    .div(lpTotalSupply)
    .sub(1);

  const withdrawnBaseTokens = (await market.balances(VBASE_INDEX))
    .mul(lpTokenToWithdraw)
    .div(lpTotalSupply)
    .sub(1);

  // burn fee component

  //      quoteTokensInclFees = quoteTokens         + liquidityTokens  * (global.totalQuoteFeesGrowth - position.totalQuoteFeesGrowth) / totalLiquidityProvided()
  // <=>          quoteTokens = quoteTokensInclFees - liquidityTokens  * (global.totalQuoteFeesGrowth - position.totalQuoteFeesGrowth) / totalLiquidityProvided()

  const withdrawnQuoteTokensExFees = rDiv(
    withdrawnQuoteTokens,
    WAD.add(global.totalQuoteFeesGrowth).sub(position.totalQuoteFeesGrowth)
  );

  const withdrawnBaseTokensExFees = rDiv(
    withdrawnBaseTokens,
    WAD.add(global.totalBaseFeesGrowth).sub(position.totalBaseFeesGrowth)
  );

  return {
    withdrawnBaseTokens: withdrawnBaseTokens,
    withdrawnQuoteTokens: withdrawnQuoteTokens,
    withdrawnBaseTokensExFees: withdrawnBaseTokensExFees,
    withdrawnQuoteTokensExFees: withdrawnQuoteTokensExFees,
  };
}
