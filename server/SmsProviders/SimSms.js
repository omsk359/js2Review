import SmsProvider from "./ISmsProvider";
import { ERR_TYPE } from "../../common/SomeError";
import { toQueryString } from "../../common/helpers";
import SomeError from "../../common/SomeError";

export default class SimSms extends SmsProvider {
    constructor(apiKey, logger, http) {
        super('SimSms', logger, http);
        this.apiKey = apiKey;
    }
    getBalance() {
        return this.api('get_balance');
    }
    getAvailableCnts() {
        let cnt = this.api('get_count');
        return _.isNaN(cnt) ? 0 : cnt;
    }
    cost() {
        return 9.9;
    }
    getPhone() {
        while (true) {
            var numberResult = this.api('get_number'), { log } = this;
            if (_.includes(SmsProvider.USED_PHONES, numberResult.number)) {
                log.info(`Номер ${numberResult.number} использовался ранее`);
                this.delay(7);
            } else
                break;
        }
        this.numberId = numberResult.id;
        log.debug('[{2}] ID: {1}', this.numberId, this.getName());
        return this.number = '7' + numberResult.number;
    }
    getSms(resendSms) {
        let { log } = this;
        try {
            this.code = this.api('get_sms', this.numberId);
            this.timeoutCnt = 0;
            return this.code;
        } catch (e) {
            if (e.name == ERR_TYPE.SMS && e.message == 'TIMEOUT' && resendSms) {
                this.timeoutCnt = this.timeoutCnt || 0;
                if (this.timeoutCnt > 1)
                    throw e;
                log.info('Повторная отправка СМС');
                resendSms();
                this.timeoutCnt++;
                return this.getSms(resendSms);
            }
            throw e;
        }
    }
    reject() {
        this.api('ban', this.numberId);
    }
    api(method, id = 1, country = 'ru') {
        let { http, log } = this;
        let params = { metod: method, apikey: this.apiKey, service: 'opt4' };
        let checkResponse = response => {
            try {
                let content = response.content.replace(/\}.*/, '}');
                var json = JSON.parse(content);
            } catch (e) {
                log.debug('JSON.parse: {1}', e.message);
                log.debug('response: {1}', response.content);
                throw e;
            }
            if (json['response'] == 'error') {
                let errMsg = json['error_msg'];
                log.error('[{2}] {1}', errMsg, this.getName());
                throw new SomeError(ERR_TYPE.SMS, errMsg);
            }
            return json;
        };
        let response, json, url = 'http://simsms.org/priemnik.php?';

        switch (method) {
            case 'get_balance':
                response = http.get(url + toQueryString(params));
                json = checkResponse(response);
                return json['balance'];
            case 'get_count':
                response = http.get(url + toQueryString(_.assign(params, {service_id: 'vk'})));
                json = checkResponse(response);
                return +json['counts Vkontakte'];
            case 'get_number':
                response = http.get(url + toQueryString(_.assign(params, {country, id})));
                json = checkResponse(response);
                if (json['response'] == '2' && json['id'] == '-1') {
                    log.info('[{1}] Номера заняты', this.getName());
                    this.onNoAvailableNumbers(this);
                    this.delay(30);
                    return this.api(method, id, country);
                }
                if (json['response'] == '5') {
                    log.info('Превышено количество запросов');
                    this.delay(10);
                    return this.api(method, id, country);
                }
                return json;
            case 'ban':
                response = http.get(url + toQueryString(_.assign(params, {id})));
                json = checkResponse(response);
                if (json['response'] == '2') {
                    log.error('[{2}] [ban] Ошибка: {1}', response, this.getName());
                    return false;
                }
                return true;
            case 'get_sms':
                response = http.get(url + toQueryString(_.assign(params, {country, id})));
                json = checkResponse(response);
                const timeoutSeconds = 9 * 60, delaySeconds = 20;
                if (json['response'] == '2' && json['sms'] == '') {
                    if (!this.firstRequestTime)
                        this.firstRequestTime = new Date();
                    else if (moment().diff(this.firstRequestTime, 'seconds') > timeoutSeconds) {
                        log.info('Смс не пришло в течении 9 мин. Отмена');
                        throw new SomeError(ERR_TYPE.SMS, 'CHANGE_PROVIDER');
                    }
                    log.error('[{1}] SMS ещё не найдено', this.getName());
                    this.delay(delaySeconds);
                    return this.api(method, id, country);
                } else if (json['response'] == '3')
                    throw new SomeError(ERR_TYPE.SMS,
                        'Такой СМС нет, либо айди запроса не верный, либо истек срок ожидания СМС');
                if (json['response'] == '5') {
                    log.info('Превышено количество запросов');
                    this.delay(10);
                    return this.api(method, id, country);
                }
                return json['sms'];
            case 'denial':
                response = http.get(url + toQueryString(_.assign(params, {country, id})));
                json = checkResponse(response);
                if (json['response'] == '2') {
                    log.error('[{2}] [denial] Ошибка: {1}', response, this.getName());
                    return false;
                }
                return true;
            default:
                throw new SomeError(ERR_TYPE.SMS, `Unknown method: ${method}`);
        }
    }
    clone() {
        let cp = new SimSms(this.apiKey, this.log, this.http);
        cp.setOnLowBalanceCb(this.onLowBalance);
        cp.setOnNoAvailableNumbersCb(this.onNoAvailableNumbers);
        return cp;
    }
}
