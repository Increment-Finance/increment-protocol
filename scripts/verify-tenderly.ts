import {expect} from 'chai';
import {isAddress} from 'ethers/lib/utils';
import env = require('hardhat');

import fs from 'fs';
import {tEthereumAddress} from '../helpers/types';

const getDeployments = () => {
  return JSON.parse(
    fs.readFileSync(
      `./deployments/${env.network.name}/all-deployments.json`,
      'utf-8'
    )
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verifyAllContracts = async (deployments: any) => {
  expect(deployments.name).to.be.equal(env.network.name);

  const contracts = deployments.contracts;

  for (const contractName in contracts) {
    const contract = contracts[contractName as keyof typeof contracts];
    const address = contract['address' as keyof typeof contract];

    if (isAddress(address)) {
      console.log('Verifying contract: ' + contractName + ' at', address);

      env.network.name === 'tenderly'
        ? await _verifyTenderlyForkContract(contractName, address)
        : await _verifyTestnetContract(contractName, address);
    }
  }
};

async function _verifyTestnetContract(
  contractName: string,
  address: tEthereumAddress
) {
  await env.tenderly.verify({
    name: contractName,
    address: address,
    network: env.network.name,
  });

  await env.tenderly.push({});
}

async function _verifyTenderlyForkContract(
  contractName: string,
  address: tEthereumAddress
) {
  env.tenderly.network().setFork('506b76bf-e339-4067-871e-d7bd9df8f926');

  await env.tenderly.network().verify({
    name: contractName,
    address: address,
  });
}

// verify the contract by running: `yarn hardhat run scripts/tenderly.ts --network tenderly`
const main = async function () {
  // const forkId = '506b76bf-e339-4067-871e-d7bd9df8f926';

  const deployments = getDeployments();

  await verifyAllContracts(deployments);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
