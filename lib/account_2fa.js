"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Account2FA = void 0;
const crypto_1 = require("@near-js/crypto");
const types_1 = require("@near-js/types");
const providers_1 = require("@near-js/providers");
const transactions_1 = require("@near-js/transactions");
const utils_1 = require("@near-js/utils");
const bn_js_1 = __importDefault(require("bn.js"));
const account_multisig_1 = require("./account_multisig");
const constants_1 = require("./constants");
const types_2 = require("./types");
const { addKey, deleteKey, deployContract, fullAccessKey, functionCall, functionCallAccessKey } = transactions_1.actionCreators;
class Account2FA extends account_multisig_1.AccountMultisig {
    constructor(connection, accountId, options) {
        super(connection, accountId, options);
        this.helperUrl = 'https://helper.testnet.near.org';
        this.helperUrl = options.helperUrl || this.helperUrl;
        this.storage = options.storage;
        this.sendCode = options.sendCode || this.sendCodeDefault;
        this.getCode = options.getCode || this.getCodeDefault;
        this.verifyCode = options.verifyCode || this.verifyCodeDefault;
        this.onConfirmResult = options.onConfirmResult;
    }
    /**
     * Sign a transaction to preform a list of actions and broadcast it using the RPC API.
     * @see {@link "@near-js/providers".json-rpc-provider.JsonRpcProvider.sendTransaction | JsonRpcProvider.sendTransaction}
     */
    signAndSendTransaction({ receiverId, actions }) {
        const _super = Object.create(null, {
            signAndSendTransaction: { get: () => super.signAndSendTransaction }
        });
        return __awaiter(this, void 0, void 0, function* () {
            yield _super.signAndSendTransaction.call(this, { receiverId, actions });
            // TODO: Should following override onRequestResult in superclass instead of doing custom signAndSendTransaction?
            yield this.sendCode();
            const result = yield this.promptAndVerify();
            if (this.onConfirmResult) {
                yield this.onConfirmResult(result);
            }
            return result;
        });
    }
    // default helpers for CH deployments of multisig
    deployMultisig(contractBytes) {
        const _super = Object.create(null, {
            signAndSendTransactionWithAccount: { get: () => super.signAndSendTransactionWithAccount }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            const seedOrLedgerKey = (yield this.getRecoveryMethods()).data
                .filter(({ kind, publicKey }) => (kind === 'phrase' || kind === 'ledger') && publicKey !== null)
                .map((rm) => rm.publicKey);
            const fak2lak = (yield this.getAccessKeys())
                .filter(({ public_key, access_key: { permission } }) => permission === 'FullAccess' && !seedOrLedgerKey.includes(public_key))
                .map((ak) => ak.public_key)
                .map(toPK);
            const confirmOnlyKey = toPK((yield this.postSignedJson('/2fa/getAccessKey', { accountId })).publicKey);
            const newArgs = Buffer.from(JSON.stringify({ 'num_confirmations': 2 }));
            const actions = [
                ...fak2lak.map((pk) => deleteKey(pk)),
                ...fak2lak.map((pk) => addKey(pk, functionCallAccessKey(accountId, constants_1.MULTISIG_CHANGE_METHODS, null))),
                addKey(confirmOnlyKey, functionCallAccessKey(accountId, constants_1.MULTISIG_CONFIRM_METHODS, null)),
                deployContract(contractBytes),
            ];
            const newFunctionCallActionBatch = actions.concat(functionCall('new', newArgs, constants_1.MULTISIG_GAS, constants_1.MULTISIG_DEPOSIT));
            utils_1.Logger.log('deploying multisig contract for', accountId);
            const { stateStatus: multisigStateStatus } = yield this.checkMultisigCodeAndStateStatus(contractBytes);
            switch (multisigStateStatus) {
                case types_2.MultisigStateStatus.STATE_NOT_INITIALIZED:
                    return yield _super.signAndSendTransactionWithAccount.call(this, accountId, newFunctionCallActionBatch);
                case types_2.MultisigStateStatus.VALID_STATE:
                    return yield _super.signAndSendTransactionWithAccount.call(this, accountId, actions);
                case types_2.MultisigStateStatus.INVALID_STATE:
                    throw new types_1.TypedError(`Can not deploy a contract to account ${this.accountId} on network ${this.connection.networkId}, the account has existing state.`, 'ContractHasExistingState');
                default:
                    throw new types_1.TypedError(`Can not deploy a contract to account ${this.accountId} on network ${this.connection.networkId}, the account state could not be verified.`, 'ContractStateUnknown');
            }
        });
    }
    disableWithFAK({ contractBytes, cleanupContractBytes }) {
        return __awaiter(this, void 0, void 0, function* () {
            let cleanupActions = [];
            if (cleanupContractBytes) {
                yield this.deleteAllRequests().catch(e => e);
                cleanupActions = yield this.get2faDisableCleanupActions(cleanupContractBytes);
            }
            const keyConversionActions = yield this.get2faDisableKeyConversionActions();
            const actions = [
                ...cleanupActions,
                ...keyConversionActions,
                deployContract(contractBytes)
            ];
            const accessKeyInfo = yield this.findAccessKey(this.accountId, actions);
            if (accessKeyInfo && accessKeyInfo.accessKey && accessKeyInfo.accessKey.permission !== 'FullAccess') {
                throw new types_1.TypedError('No full access key found in keystore. Unable to bypass multisig', 'NoFAKFound');
            }
            return this.signAndSendTransactionWithAccount(this.accountId, actions);
        });
    }
    get2faDisableCleanupActions(cleanupContractBytes) {
        return __awaiter(this, void 0, void 0, function* () {
            const currentAccountState = yield this.viewState('').catch(error => {
                const cause = error.cause && error.cause.name;
                if (cause == 'NO_CONTRACT_CODE') {
                    return [];
                }
                throw cause == 'TOO_LARGE_CONTRACT_STATE'
                    ? new types_1.TypedError(`Can not deploy a contract to account ${this.accountId} on network ${this.connection.networkId}, the account has existing state.`, 'ContractHasExistingState')
                    : error;
            });
            const currentAccountStateKeys = currentAccountState.map(({ key }) => key.toString('base64'));
            return currentAccountState.length ? [
                deployContract(cleanupContractBytes),
                functionCall('clean', { keys: currentAccountStateKeys }, constants_1.MULTISIG_GAS, new bn_js_1.default('0'))
            ] : [];
        });
    }
    get2faDisableKeyConversionActions() {
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            const accessKeys = yield this.getAccessKeys();
            const lak2fak = accessKeys
                .filter(({ access_key }) => access_key.permission !== 'FullAccess')
                .filter(({ access_key }) => {
                const perm = access_key.permission.FunctionCall;
                return perm.receiver_id === accountId &&
                    perm.method_names.length === 4 &&
                    perm.method_names.includes('add_request_and_confirm');
            });
            const confirmOnlyKey = crypto_1.PublicKey.from((yield this.postSignedJson('/2fa/getAccessKey', { accountId })).publicKey);
            return [
                deleteKey(confirmOnlyKey),
                ...lak2fak.map(({ public_key }) => deleteKey(crypto_1.PublicKey.from(public_key))),
                ...lak2fak.map(({ public_key }) => addKey(crypto_1.PublicKey.from(public_key), fullAccessKey()))
            ];
        });
    }
    /**
     * This method converts LAKs back to FAKs, clears state and deploys an 'empty' contract (contractBytes param)
     * @param [contractBytes]{@link https://github.com/near/near-wallet/blob/master/packages/frontend/src/wasm/main.wasm?raw=true}
     * @param [cleanupContractBytes]{@link https://github.com/near/core-contracts/blob/master/state-cleanup/res/state_cleanup.wasm?raw=true}
     */
    disable(contractBytes, cleanupContractBytes) {
        return __awaiter(this, void 0, void 0, function* () {
            const { stateStatus } = yield this.checkMultisigCodeAndStateStatus();
            if (stateStatus !== types_2.MultisigStateStatus.VALID_STATE && stateStatus !== types_2.MultisigStateStatus.STATE_NOT_INITIALIZED) {
                throw new types_1.TypedError(`Can not deploy a contract to account ${this.accountId} on network ${this.connection.networkId}, the account state could not be verified.`, 'ContractStateUnknown');
            }
            let deleteAllRequestsError;
            yield this.deleteAllRequests().catch(e => deleteAllRequestsError = e);
            const cleanupActions = yield this.get2faDisableCleanupActions(cleanupContractBytes).catch(e => {
                if (e.type === 'ContractHasExistingState') {
                    throw deleteAllRequestsError || e;
                }
                throw e;
            });
            const actions = [
                ...cleanupActions,
                ...(yield this.get2faDisableKeyConversionActions()),
                deployContract(contractBytes),
            ];
            utils_1.Logger.log('disabling 2fa for', this.accountId);
            return yield this.signAndSendTransaction({
                receiverId: this.accountId,
                actions
            });
        });
    }
    sendCodeDefault() {
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            const { requestId } = this.getRequest();
            const method = yield this.get2faMethod();
            yield this.postSignedJson('/2fa/send', {
                accountId,
                method,
                requestId,
            });
            return requestId;
        });
    }
    getCodeDefault() {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error('There is no getCode callback provided. Please provide your own in AccountMultisig constructor options. It has a parameter method where method.kind is "email" or "phone".');
        });
    }
    promptAndVerify() {
        return __awaiter(this, void 0, void 0, function* () {
            const method = yield this.get2faMethod();
            const securityCode = yield this.getCode(method);
            try {
                const result = yield this.verifyCode(securityCode);
                // TODO: Parse error from result for real (like in normal account.signAndSendTransaction)
                return result;
            }
            catch (e) {
                utils_1.Logger.warn('Error validating security code:', e);
                if (e.toString().includes('invalid 2fa code provided') || e.toString().includes('2fa code not valid')) {
                    return yield this.promptAndVerify();
                }
                throw e;
            }
        });
    }
    verifyCodeDefault(securityCode) {
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            const request = this.getRequest();
            if (!request) {
                throw new Error('no request pending');
            }
            const { requestId } = request;
            return yield this.postSignedJson('/2fa/verify', {
                accountId,
                securityCode,
                requestId
            });
        });
    }
    getRecoveryMethods() {
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            return {
                accountId,
                data: yield this.postSignedJson('/account/recoveryMethods', { accountId })
            };
        });
    }
    get2faMethod() {
        return __awaiter(this, void 0, void 0, function* () {
            let { data } = yield this.getRecoveryMethods();
            if (data && data.length) {
                data = data.find((m) => m.kind.indexOf('2fa-') === 0);
            }
            if (!data)
                return null;
            const { kind, detail } = data;
            return { kind, detail };
        });
    }
    signatureFor() {
        return __awaiter(this, void 0, void 0, function* () {
            const { accountId } = this;
            const block = yield this.connection.provider.block({ finality: 'final' });
            const blockNumber = block.header.height.toString();
            const signed = yield this.connection.signer.signMessage(Buffer.from(blockNumber), accountId, this.connection.networkId);
            const blockNumberSignature = Buffer.from(signed.signature).toString('base64');
            return { blockNumber, blockNumberSignature };
        });
    }
    postSignedJson(path, body) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield (0, providers_1.fetchJson)(this.helperUrl + path, JSON.stringify(Object.assign(Object.assign({}, body), (yield this.signatureFor()))));
        });
    }
}
exports.Account2FA = Account2FA;
// helpers
const toPK = (pk) => crypto_1.PublicKey.from(pk);
