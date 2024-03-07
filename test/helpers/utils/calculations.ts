import {BigNumber, utils} from 'ethers';

import {WAD, HALF_WAD} from '../../../helpers/constants';

export const rMul = (a: BigNumber, b: BigNumber): BigNumber => {
  const prod = a.mul(b);

  // ethers BigNumber does not round values when the first decimal place is gte 0.5
  // When the value is negative, we must sub 1 before returning to round properly
  // When the value is positive, we must add 1 before returning to round properly
  if (prod.abs().mod(WAD).gt(HALF_WAD)) {
    if (prod.lt(0)) {
      return a.mul(b).div(WAD).sub(1);
    } else {
      return a.mul(b).div(WAD).add(1);
    }
  }
  return a.mul(b).div(WAD);
};

export const rDiv = (a: BigNumber, b: BigNumber): BigNumber =>
  a.mul(WAD).div(b);

export const asBigNumber = (number: string): BigNumber =>
  utils.parseEther(number);

export const asDecimal = (number: BigNumber): string =>
  utils.formatEther(number);
