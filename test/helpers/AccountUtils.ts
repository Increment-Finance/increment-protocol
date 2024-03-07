import env from 'hardhat';
import {
  fundAccountsHardhat,
  impersonateAccountsHardhat,
  setupUser,
} from '../../helpers/misc-utils';
import {tEthereumAddress} from '../../helpers/types';
import {getContracts, User} from './setup';

// utils

// Warning: This does not allow you to setup an user with any market apart from idx = 0
export async function takeOverAndFundAccountSetupUser(
  account: tEthereumAddress
): Promise<User> {
  await takeOverAndFundAccount(account);

  // return user object
  return await setupUser(account, await getContracts(account));
}

export async function takeOverAndFundAccount(
  account: tEthereumAddress
): Promise<void> {
  // take over account
  await impersonateAccountsHardhat([account], env);

  // fund with ether
  await fundAccountsHardhat([account], env);
}
