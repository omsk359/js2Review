import SmsProvider from "./ISmsProvider";
import { ERR_TYPE } from "../../common/SomeError";
import SomeError from "../../common/SomeError";
import { toQueryString } from "../../common/helpers";

export default class SmsLike extends SmsProvider {
    constructor(apiKey, logger, http) {
        super('SmsLike', logger, http);
        this.apiKey = apiKey;
    }
    getBalance() {
        return this.api('getbalance');
    }
    getAvailableCnts() {
        return this.api('getnumberscount');
    }
    cost() {
        return 13.5;
    }
    getPhone() {
        let { log } = this;
        while (true) {
            this.numberId = this.api('regnum');
            log.debug('[{2}] ID: {1}', this.numberId, this.getName());
            this.number = this.api('getstate', this.numberId);

            if (_.includes(SmsProvider.USED_PHONES, this.number)) {
                log.info(`Номер ${this.number} использовался ранее`);
                this.delay(7);
            } else
                break;
        }
        return this.number;
    }
    getSms(resendSms) {
        let { log } = this;
        this.api('setready', this.numberId);
        log.info('Смс отправлено');
        this.delay(10);
        try {
            return this.code = this.api('getstate', this.numberId);
        } catch (e) {
            if (e.name == ERR_TYPE.SMS && e.message == 'RESEND') {
                log.info('Ожидание повторной отправки смс');
                resendSms();
                this.api('setStatus', this.numberId, 6);
                return this.getSms();
            }
            throw e;
        }
    }
    reject() {
        this.api('setused', this.numberId);
    }
    accept() {
        //this.api('setready', this.numberId);
    }
    api(method, id, service = 'vk', location = 0) {
        switch (service) {
            case 'vk': service = 5; break;
            default:
                throw new SomeError(ERR_TYPE.SMS, `Unknown service: ${service}`);
        }
        let { http, log } = this;
        let params = { mode: 'api', action: method, apikey: this.apiKey };
        let response, json, url = 'http://smslike.ru/index.php?';
        let withPrefix = s => '[{1}] {2}'.format(this.getName(), s);

        switch (method) {
            case 'getbalance':
                response = http.getMatch(url + toQueryString(params), 'BALANCE');
                return +response.content.replace('BALANCE:', '');
            case 'regnum':
                response = http.get(url + toQueryString(_.assign(params, { s: service, lc: location, tz: id })));
                if (response.content == 'WARNING_NO_NUMS') {
                    log.info(withPrefix('Номера заняты'));
                    this.onNoAvailableNumbers(this);
                    this.delay(60);
                    return this.api.apply(this, arguments);
                }
                if (response.content == 'WARNING_LOW_BALANCE') {
                    log.info(withPrefix('Закончились деньги'));
                    this.onLowBalance(this);
                    this.delay(5 * 60);
                    return this.api.apply(this, arguments);
                }
                let match = response.content.match(/OK:(\d+)/);
                if (!match)
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('Неизвестный ответ: {1}'.format(response.content)));
                return match[1];
            case 'getstate':
                response = http.getMatch(url + toQueryString(_.assign(params, { tz: id })), 'TZ_');
                let state = response.content.replace(/:.*/, '');
                switch (state) {
                    case 'TZ_NUM_PREPARE': // number
                        return response.content.replace('TZ_NUM_PREPARE:', '');
                    case 'TZ_NUM_ANSWER': // SMS
                        let answer = response.content.replace('TZ_NUM_ANSWER:', '');
                        return answer.match(/\s+(.*?)\s+/)[1];
                    case 'TZ_NUM_WAIT_NUMBER':
                        log.info(withPrefix('Запрос в очереди на выдачу номера'));
                        this.delay(2);
                        return this.api.apply(this, arguments);
                    case 'TZ_NUM_WAIT':
                        log.info(withPrefix('Ожидается ответ'));
                        const timeoutMinutes = 9, delaySeconds = 10;
                        if (!this.firstRequestTime)
                            this.firstRequestTime = new Date();
                        else if (moment().diff(this.firstRequestTime, 'seconds') > timeoutMinutes * 60) {
                            log.info(withPrefix('Смс не пришло в течении {1} мин. Отмена', timeoutMinutes));
                            throw new SomeError(ERR_TYPE.SMS, 'CHANGE_PROVIDER');
                        }
                        this.delay(delaySeconds);
                        return this.api.apply(this, arguments);
                    case 'TZ_NUM_NOT_PREPARE':
                        throw new SomeError(ERR_TYPE.SMS,
                                            withPrefix('Вы не перевели в состояние "Готов", средства возвращены'));

                    default:
                        throw new SomeError(ERR_TYPE.SMS,
                                            withPrefix('Неизвестный ответ: {1}'.format(response.content)));
                }
            case 'getnumberscount':
                response = http.get(url + toQueryString(params));
                json = JSON.parse(response.content);
                return +json[service + ''];
            case 'setready':
                response = http.getMatch(url + toQueryString(_.assign(params, { tz: id })), 'OK_READY');
                return;
            case 'setused':
                response = http.getMatch(url + toQueryString(_.assign(params, { tz: id })), 'OK_READY');
                return;
            default:
                throw new SomeError(ERR_TYPE.SMS, `Unknown method: ${method}`);
        }
    }
    clone() {
        let cp = new SmsLike(this.apiKey, this.log, this.http);
        cp.setOnLowBalanceCb(this.onLowBalance);
        cp.setOnNoAvailableNumbersCb(this.onNoAvailableNumbers);
        return cp;
    }
}
