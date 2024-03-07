// typechain objects
import {
  CurveCryptoSwapTest,
  CurveCryptoSwap2ETH,
  CurveCryptoViews,
} from '../../typechain';
import {CurveTokenV5} from '../../typechain';

// utils
import {BigNumber} from '../../helpers/types';
import {asBigNumber, rDiv, rMul} from './utils/calculations';
import {ethers} from 'hardhat';
import {VQUOTE_INDEX} from '../../helpers/constants';

/// @notice returns the amount of tokens transferred back to the user
export async function TEST_get_remove_liquidity(
  market: CurveCryptoSwap2ETH,
  _amount: BigNumber,
  min_amounts: [BigNumber, BigNumber]
): Promise<{quote: BigNumber; base: BigNumber}> {
  const [amountReturned] = await calcRemoveLiquidity(
    market,
    _amount,
    min_amounts
  );
  return {
    quote: amountReturned[0],
    base: amountReturned[1],
  };
}

/// @notice returns the amount of tokens remaining in the market
export async function TEST_dust_remove_liquidity(
  market: CurveCryptoSwap2ETH,
  _amount: BigNumber,
  min_amounts: [BigNumber, BigNumber]
): Promise<{quote: BigNumber; base: BigNumber}> {
  const [, amountRemaining] = await calcRemoveLiquidity(
    market,
    _amount,
    min_amounts
  );
  return {
    quote: amountRemaining[0],
    base: amountRemaining[1],
  };
}

/// @notice returns the amount of tokens transferred back to the user
export async function TEST_get_dy(
  market: CurveCryptoSwapTest,
  i: number,
  j: number,
  dx: BigNumber
): Promise<{dy: BigNumber; fees: BigNumber}> {
  /*
    print the results of the get_dy function line by line
  */
  if (i == j) throw new Error('i==j');
  if (i > 2 || j > 2) throw new Error('i or j > 2');

  // hardcoded for now
  const [PRECISION, PRECISIONS, price_scale] = await _getParameterization(
    market
  );

  const [xp, y] = await calcNewPoolBalances(
    market,
    dx,
    i,
    j,
    PRECISION,
    PRECISIONS,
    price_scale
  );

  const dy = await calcOutToken(j, xp, y, PRECISION, PRECISIONS, price_scale);

  return await applyFees(market, xp, dy);
}

export async function TEST_get_exactOutputSwapExFees(
  market: CurveCryptoSwap2ETH,
  curveView: CurveCryptoViews,
  eAmountOut: BigNumber,
  amountInMaximum: BigNumber,
  inIndex: number,
  outIndex: number
): Promise<{
  amountIn: BigNumber;
  amountOut: BigNumber;
}> {
  /*
  references from curve.fi discord channel:
    https://discord.com/channels/729808684359876718/729812922649542758/912804632533823488
    https://discord.com/channels/729808684359876718/729812922649542758/874863929686380565
  */
  if (eAmountOut.lt(0)) {
    throw new Error('eAmountOut < 0');
  }

  if (amountInMaximum.lt(0)) {
    throw new Error('amountInMaximum < 0');
  }

  let amountOut: BigNumber = BigNumber.from(0);

  // Binary search in [marketPrice * 0.7, marketPrice * 1.3]
  const price = await market.price_oracle();

  let amountIn =
    inIndex == VQUOTE_INDEX ? rMul(eAmountOut, price) : rDiv(eAmountOut, price);

  let maxVal = amountIn.mul(13).div(10);
  let minVal = amountIn.mul(7).div(10);

  for (let i = 0; i < 100; i++) {
    amountIn = minVal.add(maxVal).div(2);
    amountIn = amountIn.isZero() ? BigNumber.from(1) : amountIn; // lower bound of 1

    amountOut = await curveView.get_dy_ex_fees(
      market.address,
      inIndex,
      outIndex,
      amountIn
    );

    if (amountOut.eq(eAmountOut)) {
      break;
    } else if (amountOut.lt(eAmountOut)) {
      minVal = amountIn;
    } else {
      maxVal = amountIn;
    }
  }

  // take maxVal to make sure we are above the target
  if (amountOut.lt(eAmountOut)) {
    amountIn = maxVal;
    amountOut = await curveView.get_dy_ex_fees(
      market.address,
      inIndex,
      outIndex,
      maxVal
    );
  }

  if (amountIn.gt(amountInMaximum)) {
    throw new Error('amountIn > amountInMaximum');
  }

  return {
    amountIn,
    amountOut,
  };
}

/******************* HELPER FUNCTIONS  *******************/

async function calcRemoveLiquidity(
  market: CurveCryptoSwap2ETH,
  _amount: BigNumber,
  min_amounts: [BigNumber, BigNumber]
): Promise<[[BigNumber, BigNumber], [BigNumber, BigNumber]]> {
  const amountReturned: [BigNumber, BigNumber] = [
    BigNumber.from(0),
    BigNumber.from(0),
  ];
  const amountRemaining: [BigNumber, BigNumber] = [
    BigNumber.from(0),
    BigNumber.from(0),
  ];

  let d_balance: BigNumber;
  const balances = [await market.balances(0), await market.balances(1)];
  const amount = _amount.sub(1);
  const totalSupply = await curveTotalSupply(market);

  for (let i = 0; i < 2; i++) {
    d_balance = amount.mul(balances[i]).div(totalSupply);
    if (d_balance.lt(min_amounts[i])) throw new Error('MIN_AMOUNT_NOT_MET');
    amountReturned[i] = d_balance;
    amountRemaining[i] = balances[i].sub(d_balance);
  }
  return [amountReturned, amountRemaining];
}

async function curveTotalSupply(
  market: CurveCryptoSwap2ETH
): Promise<BigNumber> {
  const curveTokenAddress = await market.token();
  const curveLPtoken: CurveTokenV5 = await ethers.getContractAt(
    'CurveTokenV5',
    curveTokenAddress
  );
  return await curveLPtoken.totalSupply();
}

async function applyFees(
  market: CurveCryptoSwapTest,
  xp: BigNumber[],
  dy: BigNumber
): Promise<{dy: BigNumber; fees: BigNumber}> {
  //  console.log('CurveUtils: dy before fees', dy.toString());
  const fees = await calcFees(market, xp, dy);
  //  console.log('CurveUtils: fees', fees.toString());
  dy = dy.sub(fees);
  //  console.log('CurveUtils: dy after fees', dy.toString());

  // console.log('CurveUtils: end of get_dy(, i, j, dx, )');
  return {dy, fees};
}

async function calcFees(
  market: CurveCryptoSwapTest,
  xp: BigNumber[],
  dy: BigNumber
): Promise<BigNumber> {
  // line: 861
  const fee = await market.fee_test([xp[0], xp[1]]);
  // console.log('CurveUtils: fee', fee.toString());
  const fee_applied = fee.mul(dy).div(10 ** 10);
  // console.log('CurveUtils: fee_applied', fee_applied.toString());
  return fee_applied;
}

async function calcOutToken(
  j: number,
  xp: BigNumber[],
  y: BigNumber,
  PRECISION: BigNumber,
  PRECISIONS: BigNumber[],
  price_scale: BigNumber
): Promise<BigNumber> {
  // line: 855
  let dy;
  dy = xp[j].sub(y).sub(1);
  //  console.log('CurveUtils: dy', dy.toString());

  // line: 856
  xp[j] = y;
  //  console.log('CurveUtils: xp[j]', xp[j].toString());

  // line: 857
  if (j > 0) {
    // line: 858
    dy = dy.mul(PRECISION).div(price_scale);
    //  console.log('CurveUtils: buy base , sell quote');
    //  console.log('CurveUtils: dy', dy.toString());
  } else {
    // line: 860
    dy = dy.div(PRECISIONS[0]);
    //  console.log('CurveUtils: buy quote , sell base');
    //  console.log('CurveUtils: dy', dy.toString());
  }
  return dy;
}

async function calcNewPoolBalances(
  market: CurveCryptoSwapTest,
  dx: BigNumber,
  i: number,
  j: number,
  PRECISION: BigNumber,
  PRECISIONS: BigNumber[],
  price_scale: BigNumber
): Promise<[BigNumber[], BigNumber]> {
  //  console.log('CurveUtils: dx', dx.toString());

  // line: 844
  let xp;
  xp = [await market.balances(0), await market.balances(1)];
  //  console.log('CurveUtils: xp', xp.toString());

  // line: 846
  const A_gamma = await market.A_gamma_test();
  //  console.log('CurveUtils: A_gamma', A_gamma.toString());

  // line: 847
  let D;
  D = await market.D();
  //  console.log('CurveUtils: D', D.toString());

  // line: 848
  const future_A_gamma_time = await market.future_A_gamma_time();
  //  console.log(
  //   'CurveUtils: future_A_gamma_time',
  //   future_A_gamma_time.toString()
  // );
  if (future_A_gamma_time.gt(0)) {
    // line: 849
    const xp_tmp = await market.xp_test();
    D = await market.newton_D_test(A_gamma[0], A_gamma[1], xp_tmp);
    throw new Error('Not tested yet');
  }

  // line: 851
  xp[i] = xp[i].add(dx);
  //  console.log('CurveUtils: xp', xp.toString());

  // line: 852
  xp = [xp[0].mul(PRECISIONS[0]), xp[1].mul(price_scale).div(PRECISION)]; // price weighted amount
  //  console.log('CurveUtils: xp', xp.toString());

  // line: 854
  const y = await market.newton_y_test(
    A_gamma[0],
    A_gamma[1],
    [xp[0], xp[1]],
    D,
    j
  );
  return [xp, y];
}

async function _getParameterization(
  market: CurveCryptoSwapTest
): Promise<[BigNumber, BigNumber[], BigNumber]> {
  const PRECISION = asBigNumber('1');
  const PRECISIONS = [BigNumber.from(1), BigNumber.from(1)];
  const price_scale = (await market.price_scale()).mul(PRECISIONS[1]);

  return [PRECISION, PRECISIONS, price_scale];
}
