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
exports.Account = void 0;
const crypto_1 = require("@near-js/crypto");
const providers_1 = require("@near-js/providers");
const transactions_1 = require("@near-js/transactions");
const types_1 = require("@near-js/types");
const utils_1 = require("@near-js/utils");
const bn_js_1 = __importDefault(require("bn.js"));
const { addKey, createAccount, deleteAccount, deleteKey, deployContract, fullAccessKey, functionCall, functionCallAccessKey, stake, transfer, } = transactions_1.actionCreators;
// Default number of retries with different nonce before giving up on a transaction.
const TX_NONCE_RETRY_NUMBER = 12;
// Default wait until next retry in millis.
const TX_NONCE_RETRY_WAIT = 500;
// Exponential back off for waiting to retry.
const TX_NONCE_RETRY_WAIT_BACKOFF = 1.5;
function parseJsonFromRawResponse(response) {
    return JSON.parse(Buffer.from(response).toString());
}
function bytesJsonStringify(input) {
    return Buffer.from(JSON.stringify(input));
}
/**
 * This class provides common account related RPC calls including signing transactions with a {@link "@near-js/crypto".key_pair.KeyPair | KeyPair}.
 */
class Account {
    constructor(connection, accountId) {
        /** @hidden */
        this.accessKeyByPublicKeyCache = {};
        this.connection = connection;
        this.accountId = accountId;
    }
    /**
     * Returns basic NEAR account information via the `view_account` RPC query method
     * @see [https://docs.near.org/api/rpc/contracts#view-account](https://docs.near.org/api/rpc/contracts#view-account)
     */
    state() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.connection.provider.query({
                request_type: 'view_account',
                account_id: this.accountId,
                finality: 'optimistic'
            });
        });
    }
    /**
     * Create a signed transaction which can be broadcast to the network
     * @param receiverId NEAR account receiving the transaction
     * @param actions list of actions to perform as part of the transaction
     * @see {@link "@near-js/providers".json-rpc-provider.JsonRpcProvider.sendTransaction | JsonRpcProvider.sendTransaction}
     */
    signTransaction(receiverId, actions,mynonce) {
        return __awaiter(this, void 0, void 0, function* () {
          
            
            const block = yield this.connection.provider.block({ finality: 'final' });
            
            const blockHash = block.header.hash;



            // const accessKeyInfo = yield this.findAccessKey(receiverId, actions);
            // if (!accessKeyInfo) {
            //     throw new types_1.TypedError(`Can not sign transactions for account ${this.accountId} on network ${this.connection.networkId}, no matching key pair exists for this account`, 'KeyNotFound');
            // }
            // const { accessKey } = accessKeyInfo;


            // const nonce =accessKey.nonce.add(new bn_js_1.default(1));

           
            const nonce = mynonce;//accessKey.nonce.add(new bn_js_1.default(1));

            console.log(nonce.toNumber(),mynonce,'nonce')


            return yield (0, transactions_1.signTransaction)(receiverId, nonce, actions, (0, utils_1.baseDecode)(blockHash), this.connection.signer, this.accountId, this.connection.networkId);
        });
    }
    /**
     * Sign a transaction to preform a list of actions and broadcast it using the RPC API.
     * @see {@link "@near-js/providers".json-rpc-provider.JsonRpcProvider | JsonRpcProvider }
     */
    signAndSendTransaction({ receiverId, actions, returnError,nonce }) {

        return __awaiter(this, void 0, void 0, function* () {
            let txHash, signedTx;
            // TODO: TX_NONCE (different constants for different uses of exponentialBackoff?)
            const result = yield (0, providers_1.exponentialBackoff)(TX_NONCE_RETRY_WAIT, TX_NONCE_RETRY_NUMBER, TX_NONCE_RETRY_WAIT_BACKOFF, () => __awaiter(this, void 0, void 0, function* () {
                [txHash, signedTx] = yield this.signTransaction(receiverId, actions,nonce);
                const publicKey = signedTx.transaction.publicKey;
                try {
                    return yield this.connection.provider.sendTransaction(signedTx);
                }
                catch (error) {
                    if (error.type === 'InvalidNonce') {
                        utils_1.Logger.warn(`Retrying transaction ${receiverId}:${(0, utils_1.baseEncode)(txHash)} with new nonce.`);
                        delete this.accessKeyByPublicKeyCache[publicKey.toString()];
                        throw error;
                    }
                    if (error.type === 'Expired') {
                        utils_1.Logger.warn(`Retrying transaction ${receiverId}:${(0, utils_1.baseEncode)(txHash)} due to expired block hash`);
                        throw error;
                    }
                    error.context = new types_1.ErrorContext((0, utils_1.baseEncode)(txHash));
                    throw error;
                }
            }));
            if (!result) {
                // TODO: This should have different code actually, as means "transaction not submitted for sure"
                throw new types_1.TypedError('nonce retries exceeded for transaction. This usually means there are too many parallel requests with the same access key.', 'RetriesExceeded');
            }
            (0, utils_1.printTxOutcomeLogsAndFailures)({ contractId: signedTx.transaction.receiverId, outcome: result });
            // Should be falsy if result.status.Failure is null
            if (!returnError && typeof result.status === 'object' && typeof result.status.Failure === 'object' && result.status.Failure !== null) {
                // if error data has error_message and error_type properties, we consider that node returned an error in the old format
                if (result.status.Failure.error_message && result.status.Failure.error_type) {
                    throw new types_1.TypedError(`Transaction ${result.transaction_outcome.id} failed. ${result.status.Failure.error_message}`, result.status.Failure.error_type);
                }
                else {
                    throw (0, utils_1.parseResultError)(result);
                }
            }
            // TODO: if Tx is Unknown or Started.
            return result;
        });
    }
    /**
     * Finds the {@link AccessKeyView} associated with the accounts {@link PublicKey} stored in the {@link "@near-js/keystores".keystore.KeyStore | Keystore}.
     *
     * @todo Find matching access key based on transaction (i.e. receiverId and actions)
     *
     * @param receiverId currently unused (see todo)
     * @param actions currently unused (see todo)
     * @returns `{ publicKey PublicKey; accessKey: AccessKeyView }`
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    findAccessKey(receiverId, actions) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Find matching access key based on transaction (i.e. receiverId and actions)
            const publicKey = yield this.connection.signer.getPublicKey(this.accountId, this.connection.networkId);
            if (!publicKey) {
                throw new types_1.TypedError(`no matching key pair found in ${this.connection.signer}`, 'PublicKeyNotFound');
            }
            const cachedAccessKey = this.accessKeyByPublicKeyCache[publicKey.toString()];
            if (cachedAccessKey !== undefined) {
                return { publicKey, accessKey: cachedAccessKey };
            }
            try {
                const rawAccessKey = yield this.connection.provider.query({
                    request_type: 'view_access_key',
                    account_id: this.accountId,
                    public_key: publicKey.toString(),
                    finality: 'optimistic'
                });
                // store nonce as BN to preserve precision on big number
                const accessKey = Object.assign(Object.assign({}, rawAccessKey), { nonce: new bn_js_1.default(rawAccessKey.nonce) });
                // this function can be called multiple times and retrieve the same access key
                // this checks to see if the access key was already retrieved and cached while
                // the above network call was in flight. To keep nonce values in line, we return
                // the cached access key.
                if (this.accessKeyByPublicKeyCache[publicKey.toString()]) {
                    return { publicKey, accessKey: this.accessKeyByPublicKeyCache[publicKey.toString()] };
                }
                this.accessKeyByPublicKeyCache[publicKey.toString()] = accessKey;
                return { publicKey, accessKey };
            }
            catch (e) {
                if (e.type == 'AccessKeyDoesNotExist') {
                    return null;
                }
                throw e;
            }
        });
    }
    /**
     * Create a new account and deploy a contract to it
     *
     * @param contractId NEAR account where the contract is deployed
     * @param publicKey The public key to add to the created contract account
     * @param data The compiled contract code
     * @param amount of NEAR to transfer to the created contract account. Transfer enough to pay for storage https://docs.near.org/docs/concepts/storage-staking
     */
    createAndDeployContract(contractId, publicKey, data, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const accessKey = fullAccessKey();
            yield this.signAndSendTransaction({
                receiverId: contractId,
                actions: [createAccount(), transfer(amount), addKey(crypto_1.PublicKey.from(publicKey), accessKey), deployContract(data)]
            });
            const contractAccount = new Account(this.connection, contractId);
            return contractAccount;
        });
    }
    /**
     * @param receiverId NEAR account receiving Ⓝ
     * @param amount Amount to send in yoctoⓃ
     */
    sendMoney(receiverId, amount) {
        

        return __awaiter(this, void 0, void 0, function* () {
            return this.signAndSendTransaction({
                receiverId,
                actions: [transfer(amount)]
            });
        });
    }

    sendMoney2({receiverId, amount,nonce}) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.signAndSendTransaction({
                receiverId,
                actions: [transfer(amount)],
                nonce
            });
        });
    }

    /**
     * @param newAccountId NEAR account name to be created
     * @param publicKey A public key created from the masterAccount
     */
    createAccount(newAccountId, publicKey, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const accessKey = fullAccessKey();
            return this.signAndSendTransaction({
                receiverId: newAccountId,
                actions: [createAccount(), transfer(amount), addKey(crypto_1.PublicKey.from(publicKey), accessKey)]
            });
        });
    }
    /**
     * @param beneficiaryId The NEAR account that will receive the remaining Ⓝ balance from the account being deleted
     */
    deleteAccount(beneficiaryId) {
        return __awaiter(this, void 0, void 0, function* () {
            utils_1.Logger.log('Deleting an account does not automatically transfer NFTs and FTs to the beneficiary address. Ensure to transfer assets before deleting.');
            return this.signAndSendTransaction({
                receiverId: this.accountId,
                actions: [deleteAccount(beneficiaryId)]
            });
        });
    }
    /**
     * @param data The compiled contract code
     */
    deployContract(data) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.signAndSendTransaction({
                receiverId: this.accountId,
                actions: [deployContract(data)]
            });
        });
    }
    /** @hidden */
    encodeJSContractArgs(contractId, method, args) {
        return Buffer.concat([Buffer.from(contractId), Buffer.from([0]), Buffer.from(method), Buffer.from([0]), Buffer.from(args)]);
    }
    /**
     * Execute function call
     * @returns {Promise<FinalExecutionOutcome>}
     */
    functionCall({ contractId, methodName, args = {}, gas = utils_1.DEFAULT_FUNCTION_CALL_GAS, attachedDeposit, walletMeta, walletCallbackUrl, stringify, jsContract,nonce }) {
       
        return __awaiter(this, void 0, void 0, function* () {
            this.validateArgs(args);
            let functionCallArgs;
            if (jsContract) {
                const encodedArgs = this.encodeJSContractArgs(contractId, methodName, JSON.stringify(args));
                functionCallArgs = ['call_js_contract', encodedArgs, gas, attachedDeposit, null, true];
            }
            else {
                const stringifyArg = stringify === undefined ? transactions_1.stringifyJsonOrBytes : stringify;
                functionCallArgs = [methodName, args, gas, attachedDeposit, stringifyArg, false];
            }
            return this.signAndSendTransaction({
                receiverId: jsContract ? this.connection.jsvmAccountId : contractId,
                // eslint-disable-next-line prefer-spread
                actions: [functionCall.apply(void 0, functionCallArgs)],
                walletMeta,
                walletCallbackUrl,
                nonce
            });
        });
    }
    /**
     * @see [https://docs.near.org/concepts/basics/accounts/access-keys](https://docs.near.org/concepts/basics/accounts/access-keys)
     * @todo expand this API to support more options.
     * @param publicKey A public key to be associated with the contract
     * @param contractId NEAR account where the contract is deployed
     * @param methodNames The method names on the contract that should be allowed to be called. Pass null for no method names and '' or [] for any method names.
     * @param amount Payment in yoctoⓃ that is sent to the contract during this function call
     */
    addKey(publicKey, contractId, methodNames, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!methodNames) {
                methodNames = [];
            }
            if (!Array.isArray(methodNames)) {
                methodNames = [methodNames];
            }
            let accessKey;
            if (!contractId) {
                accessKey = fullAccessKey();
            }
            else {
                accessKey = functionCallAccessKey(contractId, methodNames, amount);
            }
            return this.signAndSendTransaction({
                receiverId: this.accountId,
                actions: [addKey(crypto_1.PublicKey.from(publicKey), accessKey)]
            });
        });
    }
    /**
     * @param publicKey The public key to be deleted
     * @returns {Promise<FinalExecutionOutcome>}
     */
    deleteKey(publicKey) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.signAndSendTransaction({
                receiverId: this.accountId,
                actions: [deleteKey(crypto_1.PublicKey.from(publicKey))]
            });
        });
    }
    /**
     * @see [https://near-nodes.io/validator/staking-and-delegation](https://near-nodes.io/validator/staking-and-delegation)
     *
     * @param publicKey The public key for the account that's staking
     * @param amount The account to stake in yoctoⓃ
     */
    stake(publicKey, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.signAndSendTransaction({
                receiverId: this.accountId,
                actions: [stake(amount, crypto_1.PublicKey.from(publicKey))]
            });
        });
    }
    /**
     * Compose and sign a SignedDelegate action to be executed in a transaction on behalf of this Account instance
     *
     * @param actions Actions to be included in the meta transaction
     * @param blockHeightTtl Number of blocks past the current block height for which the SignedDelegate action may be included in a meta transaction
     * @param receiverId Receiver account of the meta transaction
     */
    signedDelegate({ actions, blockHeightTtl, receiverId, }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { provider, signer } = this.connection;
            const { header } = yield provider.block({ finality: 'final' });
            const { accessKey, publicKey } = yield this.findAccessKey(null, null);
            const delegateAction = (0, transactions_1.buildDelegateAction)({
                actions,
                maxBlockHeight: new bn_js_1.default(header.height).add(new bn_js_1.default(blockHeightTtl)),
                nonce: new bn_js_1.default(accessKey.nonce).add(new bn_js_1.default(1)),
                publicKey,
                receiverId,
                senderId: this.accountId,
            });
            const { signedDelegateAction } = yield (0, transactions_1.signDelegateAction)({
                delegateAction,
                signer: {
                    sign: (message) => __awaiter(this, void 0, void 0, function* () {
                        const { signature } = yield signer.signMessage(message, delegateAction.senderId, this.connection.networkId);
                        return signature;
                    }),
                }
            });
            return signedDelegateAction;
        });
    }
    /** @hidden */
    validateArgs(args) {
        const isUint8Array = args.byteLength !== undefined && args.byteLength === args.length;
        if (isUint8Array) {
            return;
        }
        if (Array.isArray(args) || typeof args !== 'object') {
            throw new types_1.PositionalArgsError();
        }
    }
    /**
     * Invoke a contract view function using the RPC API.
     * @see [https://docs.near.org/api/rpc/contracts#call-a-contract-function](https://docs.near.org/api/rpc/contracts#call-a-contract-function)
     *
     * @param viewFunctionCallOptions.contractId NEAR account where the contract is deployed
     * @param viewFunctionCallOptions.methodName The view-only method (no state mutations) name on the contract as it is written in the contract code
     * @param viewFunctionCallOptions.args Any arguments to the view contract method, wrapped in JSON
     * @param viewFunctionCallOptions.parse Parse the result of the call. Receives a Buffer (bytes array) and converts it to any object. By default result will be treated as json.
     * @param viewFunctionCallOptions.stringify Convert input arguments into a bytes array. By default the input is treated as a JSON.
     * @param viewFunctionCallOptions.jsContract Is contract from JS SDK, automatically encodes args from JS SDK to binary.
     * @param viewFunctionCallOptions.blockQuery specifies which block to query state at. By default returns last "optimistic" block (i.e. not necessarily finalized).
     * @returns {Promise<any>}
     */
    viewFunction({ contractId, methodName, args = {}, parse = parseJsonFromRawResponse, stringify = bytesJsonStringify, jsContract = false, blockQuery = { finality: 'optimistic' } }) {
        return __awaiter(this, void 0, void 0, function* () {
            let encodedArgs;
            this.validateArgs(args);
            if (jsContract) {
                encodedArgs = this.encodeJSContractArgs(contractId, methodName, Object.keys(args).length > 0 ? JSON.stringify(args) : '');
            }
            else {
                encodedArgs = stringify(args);
            }
            const result = yield this.connection.provider.query(Object.assign(Object.assign({ request_type: 'call_function' }, blockQuery), { account_id: jsContract ? this.connection.jsvmAccountId : contractId, method_name: jsContract ? 'view_js_contract' : methodName, args_base64: encodedArgs.toString('base64') }));
            if (result.logs) {
                (0, utils_1.printTxOutcomeLogs)({ contractId, logs: result.logs });
            }
            return result.result && result.result.length > 0 && parse(Buffer.from(result.result));
        });
    }
    /**
     * Returns the state (key value pairs) of this account's contract based on the key prefix.
     * Pass an empty string for prefix if you would like to return the entire state.
     * @see [https://docs.near.org/api/rpc/contracts#view-contract-state](https://docs.near.org/api/rpc/contracts#view-contract-state)
     *
     * @param prefix allows to filter which keys should be returned. Empty prefix means all keys. String prefix is utf-8 encoded.
     * @param blockQuery specifies which block to query state at. By default returns last "optimistic" block (i.e. not necessarily finalized).
     */
    viewState(prefix, blockQuery = { finality: 'optimistic' }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { values } = yield this.connection.provider.query(Object.assign(Object.assign({ request_type: 'view_state' }, blockQuery), { account_id: this.accountId, prefix_base64: Buffer.from(prefix).toString('base64') }));
            return values.map(({ key, value }) => ({
                key: Buffer.from(key, 'base64'),
                value: Buffer.from(value, 'base64')
            }));
        });
    }
    /**
     * Get all access keys for the account
     * @see [https://docs.near.org/api/rpc/access-keys#view-access-key-list](https://docs.near.org/api/rpc/access-keys#view-access-key-list)
     */
    getAccessKeys() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.connection.provider.query({
                request_type: 'view_access_key_list',
                account_id: this.accountId,
                finality: 'optimistic'
            });
            // Replace raw nonce into a new BN
            return (_a = response === null || response === void 0 ? void 0 : response.keys) === null || _a === void 0 ? void 0 : _a.map((key) => (Object.assign(Object.assign({}, key), { access_key: Object.assign(Object.assign({}, key.access_key), { nonce: new bn_js_1.default(key.access_key.nonce) }) })));
        });
    }
    /**
     * Returns a list of authorized apps
     * @todo update the response value to return all the different keys, not just app keys.
     */
    getAccountDetails() {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: update the response value to return all the different keys, not just app keys.
            // Also if we need this function, or getAccessKeys is good enough.
            const accessKeys = yield this.getAccessKeys();
            const authorizedApps = accessKeys
                .filter(item => item.access_key.permission !== 'FullAccess')
                .map(item => {
                const perm = item.access_key.permission;
                return {
                    contractId: perm.FunctionCall.receiver_id,
                    amount: perm.FunctionCall.allowance,
                    publicKey: item.public_key,
                };
            });
            return { authorizedApps };
        });
    }
    /**
     * Returns calculated account balance
     */
    getAccountBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            const protocolConfig = yield this.connection.provider.experimental_protocolConfig({ finality: 'final' });
            const state = yield this.state();
            const costPerByte = new bn_js_1.default(protocolConfig.runtime_config.storage_amount_per_byte);
            const stateStaked = new bn_js_1.default(state.storage_usage).mul(costPerByte);
            const staked = new bn_js_1.default(state.locked);
            const totalBalance = new bn_js_1.default(state.amount).add(staked);
            const availableBalance = totalBalance.sub(bn_js_1.default.max(staked, stateStaked));
            return {
                total: totalBalance.toString(),
                stateStaked: stateStaked.toString(),
                staked: staked.toString(),
                available: availableBalance.toString()
            };
        });
    }
    /**
     * Returns the NEAR tokens balance and validators of a given account that is delegated to the staking pools that are part of the validators set in the current epoch.
     *
     * NOTE: If the tokens are delegated to a staking pool that is currently on pause or does not have enough tokens to participate in validation, they won't be accounted for.
     * @returns {Promise<ActiveDelegatedStakeBalance>}
     */
    getActiveDelegatedStakeBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            const block = yield this.connection.provider.block({ finality: 'final' });
            const blockHash = block.header.hash;
            const epochId = block.header.epoch_id;
            const { current_validators, next_validators, current_proposals } = yield this.connection.provider.validators(epochId);
            const pools = new Set();
            [...current_validators, ...next_validators, ...current_proposals]
                .forEach((validator) => pools.add(validator.account_id));
            const uniquePools = [...pools];
            const promises = uniquePools
                .map((validator) => (this.viewFunction({
                contractId: validator,
                methodName: 'get_account_total_balance',
                args: { account_id: this.accountId },
                blockQuery: { blockId: blockHash }
            })));
            const results = yield Promise.allSettled(promises);
            const hasTimeoutError = results.some((result) => {
                if (result.status === 'rejected' && result.reason.type === 'TimeoutError') {
                    return true;
                }
                return false;
            });
            // When RPC is down and return timeout error, throw error
            if (hasTimeoutError) {
                throw new Error('Failed to get delegated stake balance');
            }
            const summary = results.reduce((result, state, index) => {
                const validatorId = uniquePools[index];
                if (state.status === 'fulfilled') {
                    const currentBN = new bn_js_1.default(state.value);
                    if (!currentBN.isZero()) {
                        return Object.assign(Object.assign({}, result), { stakedValidators: [...result.stakedValidators, { validatorId, amount: currentBN.toString() }], total: result.total.add(currentBN) });
                    }
                }
                if (state.status === 'rejected') {
                    return Object.assign(Object.assign({}, result), { failedValidators: [...result.failedValidators, { validatorId, error: state.reason }] });
                }
                return result;
            }, { stakedValidators: [], failedValidators: [], total: new bn_js_1.default(0) });
            return Object.assign(Object.assign({}, summary), { total: summary.total.toString() });
        });
    }
}
exports.Account = Account;
