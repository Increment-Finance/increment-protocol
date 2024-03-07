/* ********************************* */
/*      FUNDING GETTERS              */
/* ********************************* */

import {BigNumber} from '../../helpers/types';
import {LibPerpetual} from '../../typechain/contracts/Perpetual';
import {TestPerpetual} from '../../typechain/contracts/test/TestPerpetual';
import {rDiv, rMul} from './utils/calculations';
import {days} from '../../helpers/time';

export async function updateTwap(
  perpetual: TestPerpetual,
  globalPosition: LibPerpetual.GlobalPositionStructOutput,
  currentTime: BigNumber
): Promise<{
  marketTwap: BigNumber;
  oracleTwap: BigNumber;
}> {
  const timeElapsed = currentTime.sub(globalPosition.timeOfLastTrade);
  /*
      priceCumulative1 = priceCumulative0 + price1 * timeElapsed
  */
  // will overflow in ~3000 years
  // update cumulative chainlink price feed
  const latestChainlinkPrice = await perpetual.indexPrice();

  const oracleCumulativeAmount = (
    await perpetual.getOracleCumulativeAmount()
  ).add(latestChainlinkPrice.mul(timeElapsed));

  // update cumulative market price feed
  const latestMarketPrice = await perpetual.marketPrice();

  const marketCumulativeAmount = (
    await perpetual.getMarketCumulativeAmount()
  ).add(latestMarketPrice.mul(timeElapsed));

  const timeElapsedSinceBeginningOfPeriod = currentTime.sub(
    globalPosition.timeOfLastTwapUpdate
  );

  let oracleTwap = await perpetual.oracleTwap();
  let marketTwap = await perpetual.marketTwap();

  const twapFrequency = await perpetual.twapFrequency();

  if (timeElapsedSinceBeginningOfPeriod.gt(twapFrequency)) {
    const oracleCumulativeAmountAtBeginningOfPeriod =
      await perpetual.getOracleCumulativeAmountAtBeginningOfPeriod();

    const marketCumulativeAmountAtBeginningOfPeriod =
      await perpetual.getMarketCumulativeAmountAtBeginningOfPeriod();

    /*
          TWAP = (priceCumulative1 - priceCumulative0) / timeElapsed
      */
    // calculate chainlink twap
    oracleTwap = oracleCumulativeAmount
      .sub(oracleCumulativeAmountAtBeginningOfPeriod)
      .div(timeElapsedSinceBeginningOfPeriod);
    // calculate market twap
    marketTwap = marketCumulativeAmount
      .sub(marketCumulativeAmountAtBeginningOfPeriod)
      .div(timeElapsedSinceBeginningOfPeriod);
  } else {
  }

  return {marketTwap: marketTwap, oracleTwap: oracleTwap};
}

export async function getFundingRate(
  perpetual: TestPerpetual,
  global: LibPerpetual.GlobalPositionStructOutput,
  currentTime: BigNumber
): Promise<BigNumber> {
  const twap = await updateTwap(perpetual, global, currentTime);

  const sensitivity = await perpetual.sensitivity();

  const currentTraderPremium = rDiv(
    twap.marketTwap.sub(twap.oracleTwap),
    twap.oracleTwap
  );

  const timePassedSinceLastTrade = currentTime.sub(global.timeOfLastTrade);

  const fundingRate = rMul(sensitivity, currentTraderPremium)
    .mul(timePassedSinceLastTrade)
    .div(days(1));

  const cumFundingRate = BigNumber.from(global.cumFundingRate).add(fundingRate);

  return cumFundingRate;
}

export async function getFundingPayment(
  globalCumFundingRate: BigNumber,
  user: LibPerpetual.TraderPositionStructOutput
): Promise<BigNumber> {
  const isLong = user.positionSize.gt(0);

  const userCumFundingRate = BigNumber.from(user.cumFundingRate);

  if (userCumFundingRate != globalCumFundingRate) {
    const upcomingFundingRate = isLong
      ? userCumFundingRate.sub(globalCumFundingRate)
      : globalCumFundingRate.sub(userCumFundingRate);

    // fundingPayments = fundingRate * vBaseAmountToSettle;

    const fundingPayments = rMul(upcomingFundingRate, user.positionSize.abs());

    return fundingPayments;
  }

  return BigNumber.from(0);
}
