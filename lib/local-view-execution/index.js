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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalViewExecution = void 0;
const utils_1 = require("@near-js/utils");
const storage_1 = require("./storage");
const runtime_1 = require("./runtime");
class LocalViewExecution {
    constructor(account) {
        this.account = account;
        this.storage = new storage_1.Storage();
    }
    fetchContractCode(contractId, blockQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.account.connection.provider.query(Object.assign({ request_type: 'view_code', account_id: contractId }, blockQuery));
            return result.code_base64;
        });
    }
    fetchContractState(blockQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.account.viewState('', blockQuery);
        });
    }
    fetch(contractId, blockQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const block = yield this.account.connection.provider.block(blockQuery);
            const blockHash = block.header.hash;
            const blockHeight = block.header.height;
            const blockTimestamp = block.header.timestamp;
            const contractCode = yield this.fetchContractCode(contractId, blockQuery);
            const contractState = yield this.fetchContractState(blockQuery);
            return {
                blockHash,
                blockHeight,
                blockTimestamp,
                contractCode,
                contractState,
            };
        });
    }
    loadOrFetch(contractId, blockQuery) {
        return __awaiter(this, void 0, void 0, function* () {
            const stored = this.storage.load(blockQuery);
            if (stored) {
                return stored;
            }
            const _a = yield this.fetch(contractId, blockQuery), { blockHash } = _a, fetched = __rest(_a, ["blockHash"]);
            this.storage.save(blockHash, fetched);
            return fetched;
        });
    }
    viewFunction(_a) {
        var { contractId, methodName, args = {}, blockQuery = { finality: 'optimistic' } } = _a, ignored = __rest(_a, ["contractId", "methodName", "args", "blockQuery"]);
        return __awaiter(this, void 0, void 0, function* () {
            const methodArgs = JSON.stringify(args);
            const { contractCode, contractState, blockHeight, blockTimestamp } = yield this.loadOrFetch(contractId, blockQuery);
            const runtime = new runtime_1.Runtime({ contractId, contractCode, contractState, blockHeight, blockTimestamp, methodArgs });
            const { result, logs } = yield runtime.execute(methodName);
            if (logs) {
                (0, utils_1.printTxOutcomeLogs)({ contractId, logs });
            }
            return JSON.parse(Buffer.from(result).toString());
        });
    }
}
exports.LocalViewExecution = LocalViewExecution;
