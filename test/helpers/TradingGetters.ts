import {User} from './setup';
import {ethers} from 'hardhat';

import {LibPerpetual} from '../../typechain/contracts/Perpetual';
import {CurveCryptoSwap2ETH, CurveCryptoViews} from '../../typechain';

import {TEST_get_exactOutputSwapExFees} from './CurveUtils';

import {BigNumber, BigNumberish} from 'ethers';

import {VQUOTE_INDEX, VBASE_INDEX} from '../../helpers/constants';

import {getMarket, getPerpetual} from './PerpetualGetters';
import {getFundingPayment, getFundingRate} from './FundingGetters';
import {rDiv, rMul} from './utils/calculations';
import {Side} from './utils/types';

/* ********************************* */
/*          Profit  getters          */
/* ********************************* */

export async function getTraderProfit(
  user: User,
  currentTime: BigNumber,
  marketIdx: BigNumberish = 0,
  proposedAmountToOverwrite: BigNumber = BigNumber.from(0) // overwrite the proposed amount for testing
): Promise<BigNumber> {
  const pnL = await getTraderPnL(user, marketIdx, proposedAmountToOverwrite);

  const funding = await getTraderFunding(user, currentTime, marketIdx);

  return pnL.add(funding);
}

export async function getTraderPnL(
  user: User,
  marketIdx: BigNumberish = 0,
  proposedAmountToOverwrite: BigNumber = BigNumber.from(0)
): Promise<BigNumber> {
  const market = await getMarket(user, marketIdx);

  const traderPosition = await user.clearingHouseViewer.getTraderPosition(
    marketIdx,
    user.address
  );

  const {pnl} = await _getPnl(
    traderPosition,
    market,
    user.curveViews,
    proposedAmountToOverwrite
  );

  return pnl;
}

export async function _getPnl(
  position: LibPerpetual.TraderPositionStructOutput,
  market: CurveCryptoSwap2ETH,
  curveViews: CurveCryptoViews,
  proposedAmountToOverwrite: BigNumber = BigNumber.from(0)
): Promise<{pnl: BigNumber; quoteProceeds: BigNumber}> {
  const isLong = position.positionSize.gt(0);

  const proposedAmount = proposedAmountToOverwrite.eq(0)
    ? await getCloseProposedAmount(position, market, curveViews)
    : proposedAmountToOverwrite;

  const {quoteProceeds, percentageFee} = isLong
    ? await getProceedsFromClosingLongPosition(
        market,
        curveViews,
        proposedAmount
      )
    : await getProceedsFromClosingShortPosition(
        market,
        curveViews,
        proposedAmount
      );

  if (isLong ? quoteProceeds.lt(0) : quoteProceeds.gt(0)) {
    throw new Error("Quote proceeds don't have correct sign");
  }

  const quoteOnlyFees = rMul(quoteProceeds.abs(), percentageFee);

  const positionPnL = position.openNotional.add(quoteProceeds);

  const pnl = positionPnL.sub(quoteOnlyFees);

  return {pnl, quoteProceeds};
}

export async function getTraderFunding(
  user: User,
  currentTime: BigNumber,
  marketIdx: BigNumberish = 0
): Promise<BigNumber> {
  const perpetual = await getPerpetual(user, marketIdx);
  const globalPosition = await user.clearingHouseViewer.getGlobalPosition(
    marketIdx
  );

  const fundingRate = await getFundingRate(
    perpetual,
    globalPosition,
    currentTime
  );

  const traderPosition = await user.clearingHouseViewer.getTraderPosition(
    marketIdx,
    user.address
  );
  return await getFundingPayment(fundingRate, traderPosition);
}

/* ********************************* */
/*          Market getters           */
/* ********************************* */

export async function getProceedsFromClosingLongPosition(
  market: CurveCryptoSwap2ETH,
  curveViews: CurveCryptoViews,
  proposedAmount: BigNumber
): Promise<{
  percentageFee: BigNumber;
  quoteProceeds: BigNumber;
}> {
  const {dyExFees, percentageFee} = await get_dy(
    curveViews,
    market,
    proposedAmount,
    VBASE_INDEX,
    VQUOTE_INDEX
  );

  return {quoteProceeds: dyExFees, percentageFee};
}

export async function getProceedsFromClosingShortPosition(
  market: CurveCryptoSwap2ETH,
  curveViews: CurveCryptoViews,
  proposedAmount: BigNumber
): Promise<{
  percentageFee: BigNumber;
  quoteProceeds: BigNumber;
}> {
  const {percentageFee} = await get_dy(
    curveViews,
    market,
    proposedAmount,
    VQUOTE_INDEX,
    VBASE_INDEX
  );

  return {quoteProceeds: proposedAmount.mul(-1), percentageFee};
}

export async function get_dy(
  curveView: CurveCryptoViews,
  market: CurveCryptoSwap2ETH,
  amountIn: BigNumber,
  SELL_INDEX: BigNumberish,
  BUY_INDEX: BigNumberish
): Promise<{
  percentageFee: BigNumber;
  dyExFees: BigNumber;
  dyInclFees: BigNumber;
}> {
  const dyInclFees = await market.get_dy(SELL_INDEX, BUY_INDEX, amountIn);

  const dyExFees = await curveView.get_dy_ex_fees(
    market.address,
    SELL_INDEX,
    BUY_INDEX,
    amountIn
  );

  const percentageFee = await getPercentageFee(dyExFees, dyInclFees);
  return {
    percentageFee: percentageFee,
    dyExFees: dyExFees,
    dyInclFees: dyInclFees,
  };
}

/* ********************************* */
/*          Proposed Amount getters  */
/* ********************************* */

// Returns a proposed amount precise enough to reduce a LONG or SHORT position
export async function getCloseProposedAmount(
  position: LibPerpetual.TraderPositionStructOutput,
  market: CurveCryptoSwap2ETH,
  curveViews: CurveCryptoViews
): Promise<BigNumber> {
  return getReduceProposedAmount(position.positionSize, market, curveViews);
}

// Returns a proposed amount precise enough to reduce a LONG or SHORT position
export async function getReduceProposedAmount(
  positionSizeToReduce: BigNumber,
  market: CurveCryptoSwap2ETH,
  curveViews: CurveCryptoViews
): Promise<BigNumber> {
  if (positionSizeToReduce.gte(0)) {
    return positionSizeToReduce;
  } else {
    return (
      await TEST_get_exactOutputSwapExFees(
        market,
        curveViews,
        positionSizeToReduce.abs(),
        ethers.constants.MaxUint256,
        VQUOTE_INDEX,
        VBASE_INDEX
      )
    ).amountIn;
  }
}

/* ********************************* */
/*     Close Position  getters       */
/* ********************************* */

export function getCloseTradeDirection(
  position: LibPerpetual.TraderPositionStructOutput
): Side {
  return position.positionSize.gt(0) ? Side.Short : Side.Long;
}

/* ********************************* */
/*      Dynamic fee calculations     */
/* ********************************* */

async function getPercentageFee(
  dyExFees: BigNumber,
  dyInclFees: BigNumber
): Promise<BigNumber> {
  const fees = dyExFees.sub(dyInclFees);
  const perFees = rDiv(fees, dyExFees);

  return perFees;
}
