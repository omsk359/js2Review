import SmsProvider from "./ISmsProvider";
import { ERR_TYPE } from "../../common/SomeError";
import SomeError from "../../common/SomeError";
import { toQueryString } from "../../common/helpers";

export default class SmsVk extends SmsProvider {
    constructor(apiKey, logger, http) {
        super('SmsVk', logger, http);
        this.apiKey = apiKey;
    }
    getBalance() {
        return this.api('getBalance');
    }
    getAvailableCnts() {
        return this.api('getNumbersStatus');
    }
    cost() {
        return 10;
    }
    getPhone() {
        while (true) {
            var numberResult = this.api('getNumber'), { log } = this;
            if (_.includes(SmsProvider.USED_PHONES, numberResult.number)) {
                log.info(`Номер ${numberResult.number} использовался ранее`);
                this.delay(7);
            } else
                break;
        }
        this.numberId = numberResult.id;
        log.debug('[{2}] ID: {1}', this.numberId, this.getName());
        return this.number = numberResult.number;
    }
    getSms(resendSms, status = 1) {
        let { log } = this;
        this.api('setStatus', this.numberId, status);
        log.info('Смс отправлено');
        this.delay(10);
        try {
            return this.code = this.api('getStatus', this.numberId);
        } catch (e) {
            if (e.name == ERR_TYPE.SMS && e.message == 'RESEND') {
                log.info('Ожидание повторной отправки смс');
                resendSms();
                return this.getSms(resendSms, 6);
            }
            throw e;
        }
    }
    reject() {
        this.api('setStatus', this.numberId, -1);
    }
    accept() {
        this.api('setStatus', this.numberId, 6);
    }
    api(method, id, status, service = 'vk') {
        let { http, log } = this;
        let params = { action: method, api_key: this.apiKey };
        let response, url = 'http://smsvk.net/stubs/handler_api.php?';
        let withPrefix = s => '[{1}] {2}'.format(this.getName(), s);

        switch (method) {
            case 'getBalance':
                response = http.getMatch(url + toQueryString(params));
                if (response.content == 'BAD_KEY')
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('Плохой ключ'));
                if (!response.content.contains('ACCESS_BALANCE'))
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('Странный баланс: {1}'.format(response.content)));
                return +response.content.replace('ACCESS_BALANCE:', '');
            case 'getNumbersStatus':
                response = http.getMatch(url + toQueryString(params));
                var json = JSON.parse(response.content);
                return +json['vk'];
            case 'getNumber':
                response = http.get(url + toQueryString(_.assign(params, {service})));
                if (response.content == 'NO_NUMBERS') {
                    log.info(withPrefix('Номера заняты'));
                    this.onNoAvailableNumbers(this);
                    this.delay(60);
                    return this.api(method, id, status, service);
                }
                if (response.content == 'NO_BALANCE') {
                    log.info(withPrefix('Закончились деньги'));
                    this.onLowBalance(this);
                    this.delay(5 * 60);
                    return this.api(method, id, status, service);
                }
                var match = response.content.match(/ACCESS_NUMBER:(\d+):(\d+)/);
                if (!match)
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('Неизвестный ответ: {1}'.format(response.content)));
                return { number: match[2], id: match[1] };
            case 'setStatus':
                response = http.getMatch(url + toQueryString(_.assign(params, {id, status})), 'ACCESS');
                switch (response.content) {
                    case 'ACCESS_READY':        return 'Готовность номера подтверждена';
                    case 'ACCESS_RETRY_GET':    return 'Ожидание нового смс';
                    case 'ACCESS_ACTIVATION':   return 'Сервис успешно активирован';
                    case 'ACCESS_CANCEL':       return 'Активация отменена';
                    default:                    return 'wat?? ' + response.content;
                }
            case 'getStatus':
                response = http.get(url + toQueryString(_.assign(params, {id})));
                const timeoutMinutes = 9, delaySeconds = 20;
                if (response.content == 'NO_ACTIVATION')
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('id активации не существует'));
                if (response.content == 'STATUS_WAIT_CODE'){
                    if (!this.firstRequestTime)
                        this.firstRequestTime = new Date();
                    else if (moment().diff(this.firstRequestTime, 'seconds') > timeoutMinutes * 60) {
                        log.info(withPrefix('Смс не пришло в течении {1} мин. Отмена', timeoutMinutes));
                        throw new SomeError(ERR_TYPE.SMS, 'CHANGE_PROVIDER');
                    }
                    log.info('Ожидание смс');
                    this.delay(delaySeconds);
                    return this.api(method, id, status, service);
                }
                if (response.content.startsWith('STATUS_WAIT_RETRY')) {
                    match = response.content.match(/STATUS_WAIT_RETRY:(\d+)/);
                    if (!match)
                        throw new SomeError(ERR_TYPE.SMS, 'Неправильный ответ сервера: {1}', response.content);
                }
                if (response.content == 'STATUS_WAIT_RESEND')
                    throw new SomeError(ERR_TYPE.SMS, 'RESEND');

                match = response.content.match(/STATUS_OK:(\d+)/);
                if (!match)
                    throw new SomeError(ERR_TYPE.SMS, 'Неправильный ответ сервера: {1}', response.content);
                return match[1];
            default:
                throw new SomeError(ERR_TYPE.SMS, `Unknown method: ${method}`);
        }
    }
    clone() {
        let cp = new SmsVk(this.apiKey, this.log, this.http);
        cp.setOnLowBalanceCb(this.onLowBalance);
        cp.setOnNoAvailableNumbersCb(this.onNoAvailableNumbers);
        return cp;
    }
}
