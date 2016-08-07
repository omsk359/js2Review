import HttpHelpers from "../lib/HttpHelpers";
import { log } from "../../common/logger/Logger";

var USED_PHONES = [];

export default class SmsProvider {
    constructor(providerName, logger = log, http = new HttpHelpers(logger)) {
        this.http = http;
        this.log = logger;
        this.providerName = providerName;
        this.onLowBalance = () => {};
        this.onNoAvailableNumbers = () => {};
    }
    getPhone() {}
    getSms(resendSms) {}
    getName() { return this.providerName; }
    accept() {}
    reject() {}
    getBalance() { return -1; }
    getAvailableCnts(service = 'vk') { return -1; }
    cost() { return 1e+5 }
    delay(sec) {
        this.log.info('[{2}] Пауза {1} сек.', sec, this.getName());
        Meteor._sleepForMs(sec * 1000);
    }
    clone() {}
    setOnLowBalanceCb(cb) {
        this.onLowBalance = cb;
    }
    setOnNoAvailableNumbersCb(cb) {
        this.onNoAvailableNumbers = cb;
    }
    static get USED_PHONES() {
        return USED_PHONES;
    }
}
