import { FinalExecutionOutcome } from '@near-js/types';
import { SignAndSendTransactionOptions } from './account';
import { AccountMultisig } from './account_multisig';
import { Connection } from './connection';
type sendCodeFunction = () => Promise<any>;
type getCodeFunction = (method: any) => Promise<string>;
type verifyCodeFunction = (securityCode: any) => Promise<any>;
export declare class Account2FA extends AccountMultisig {
    /********************************
    Account2FA has options object where you can provide callbacks for:
    - sendCode: how to send the 2FA code in case you don't use NEAR Contract Helper
    - getCode: how to get code from user (use this to provide custom UI/UX for prompt of 2FA code)
    - onResult: the tx result after it's been confirmed by NEAR Contract Helper
    ********************************/
    sendCode: sendCodeFunction;
    getCode: getCodeFunction;
    verifyCode: verifyCodeFunction;
    onConfirmResult: (any: any) => any;
    helperUrl: string;
    constructor(connection: Connection, accountId: string, options: any);
    /**
     * Sign a transaction to preform a list of actions and broadcast it using the RPC API.
     * @see {@link "@near-js/providers".json-rpc-provider.JsonRpcProvider.sendTransaction | JsonRpcProvider.sendTransaction}
     */
    signAndSendTransaction({ receiverId, actions }: SignAndSendTransactionOptions): Promise<FinalExecutionOutcome>;
    deployMultisig(contractBytes: Uint8Array): Promise<FinalExecutionOutcome>;
    disableWithFAK({ contractBytes, cleanupContractBytes }: {
        contractBytes: Uint8Array;
        cleanupContractBytes?: Uint8Array;
    }): Promise<FinalExecutionOutcome>;
    get2faDisableCleanupActions(cleanupContractBytes: Uint8Array): Promise<import("@near-js/transactions").Action[]>;
    get2faDisableKeyConversionActions(): Promise<import("@near-js/transactions").Action[]>;
    /**
     * This method converts LAKs back to FAKs, clears state and deploys an 'empty' contract (contractBytes param)
     * @param [contractBytes]{@link https://github.com/near/near-wallet/blob/master/packages/frontend/src/wasm/main.wasm?raw=true}
     * @param [cleanupContractBytes]{@link https://github.com/near/core-contracts/blob/master/state-cleanup/res/state_cleanup.wasm?raw=true}
     */
    disable(contractBytes: Uint8Array, cleanupContractBytes: Uint8Array): Promise<FinalExecutionOutcome>;
    sendCodeDefault(): Promise<any>;
    getCodeDefault(): Promise<string>;
    promptAndVerify(): any;
    verifyCodeDefault(securityCode: string): Promise<any>;
    getRecoveryMethods(): Promise<{
        accountId: string;
        data: any;
    }>;
    get2faMethod(): Promise<{
        kind: any;
        detail: any;
    }>;
    signatureFor(): Promise<{
        blockNumber: string;
        blockNumberSignature: string;
    }>;
    postSignedJson(path: any, body: any): Promise<any>;
}
export {};
//# sourceMappingURL=account_2fa.d.ts.map