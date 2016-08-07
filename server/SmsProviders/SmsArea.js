import SmsProvider from "./ISmsProvider";
import { ERR_TYPE } from "../../common/SomeError";
import { toQueryString } from "../../common/helpers";
import SomeError from "../../common/SomeError";

export default class SmsArea extends SmsProvider {
    constructor(apiKey, logger, http) {
        super('SmsArea', logger, http);
        this.apiKey = apiKey;
    }
    getBalance() {
        return this.api('getBalance');
    }
    getAvailableCnts() {
        let { http, log } = this;
        let response = http.get('http://sms-area.org/settings.php?page=rates');
        if (!response.content.contains('blockServiceHeader')) {
            http.headers['Referer'] = 'http://sms-area.org';
            response = http.post('http://sms-area.org/login.php', {
                loginEmail: Meteor.settings.smsAreaLogin,
                loginPassword: Meteor.settings.smsAreaPass
            });
            response = http.get('http://sms-area.org/settings.php?page=rates');
            if (!response.content.contains('blockServiceHeader')) {
                log.error('[{1}] Не найден blockServiceHeader: {2}', this.getName(), response.content);
                return -1;
            }
        }
        let match = response.content.match(/<div class="plate-vk"([\s\S]*?)<\/div/);
        if (!match) {
            log.error('[{1}] Не найден plate-vk: {2}', this.getName(), response.content);
            return -1;
        }
        let inputRe = /input[^>]*value="(.*?)"/g;
        let matches = inputRe.exec(match[1]);
        this.availableCnts = +matches[1];
        this._cost = +inputRe.exec(match[1])[1];
        return this.availableCnts;
    }
    cost() {
        if (this._cost)
            return this._cost;
        this.getAvailableCnts();
        return this._cost;
    }
    getPhone() {
        this.numberId = null;
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
    getSms(resendSms) {
        let { log } = this;
        this.api('setStatus', this.numberId, 1);
        log.info('Смс отправлено');
        this.delay(10);
        try {
            return this.code = this.api('getStatus', this.numberId);
        } catch (e) {
            if (e.name == ERR_TYPE.SMS && e.message == 'RESEND') {
                log.info('Ожидание повторной отправки смс');
                resendSms();
                return this.getSms();
            }
            throw e;
        }
    }
    reject() {
        if (this.numberId)
            this.api('setStatus', this.numberId, -1);
        else
            this.api('setStatus', this.numberId, 10);
    }
    accept() {
        this.api('setStatus', this.numberId, 6);
    }
    api(method, id, status, service = 'vk', country = 'ru', count = 1) {
        let { http, log } = this;
        let params = { action: method, api_key: this.apiKey };
        let response, json, url = 'http://sms-area.org/stubs/handler_api.php?';
        let withPrefix = s => '[{1}] {2}'.format(this.getName(), s);
        
        switch (method) {
            case 'getBalance':
                response = http.getMatch(url + toQueryString(params), 'ACCESS_BALANCE');
                return +response.content.replace('ACCESS_BALANCE:', '');
            case 'getNumber':
                response = http.get(url + toQueryString(_.assign(params, { service, country, count })));
                if (response.content.contains('NO_NUMBER')) {
                    log.info(withPrefix('Номера заняты'));
                    this.onNoAvailableNumbers(this);
                    this.delay(60);
                    return this.api(method, id, status, service);
                }
                if (response.content == 'NO_MEANS') {
                    log.info(withPrefix('Закончились деньги'));
                    this.onLowBalance(this);
                    this.delay(5 * 60);
                    return this.api(method, id, status, service);
                }
                if (response.content == 'NO_ACTIVATORS_RATE') {
                    log.info(withPrefix('Ставка активаторов выше вашей'));
                    this.onLowBalance(this);
                    this.delay(2 * 60);
                    return this.api(method, id, status, service);
                }
                var match = response.content.match(/ACCESS_NUMBER:(\d+):(\d+)/);
                if (!match)
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('Неизвестный ответ: {1}'.format(response.content)));
                return { number: match[2], id: match[1] };
            case 'setStatus':
                response = http.getMatch(url + toQueryString(_.assign(params, {id, status})), 'ACCESS');
                switch (response.content) {
                    case 'ACCESS_READY':            return 'Готовность номера подтверждена';
                    case 'ACCESS_RETRY_GET':        return 'Ожидание нового смс';
                    case 'ACCESS_ACTIVATION':       return 'Сервис успешно активирован';
                    case 'ACCESS_ERROR_NUMBER_GET': return 'Номер отмечен как использованный';
                    case 'ACCESS_REPORT':           return 'Подтверждающий скрин успешно запрошен';
                    case 'ACCESS_CANCEL':           return 'Активация отменена';
                    default:                        return 'wat?? ' + response.content;
                }
            case 'getStatus':
                response = http.getMatch(url + toQueryString(_.assign(params, {id})), 'STATUS');
                const timeoutMinutes = 20, delaySeconds = 20;
                if (response.content == 'NO_ACTIVATION')
                    throw new SomeError(ERR_TYPE.SMS, withPrefix('id активации не существует'));
                if (response.content == 'STATUS_WAIT_CODE') {
                    if (!this.firstRequestTime)
                        this.firstRequestTime = new Date();
                    else if (moment().diff(this.firstRequestTime, 'seconds') > timeoutMinutes * 60) {
                        log.info(withPrefix(`Смс не пришло в течении ${timeoutMinutes} мин. Отмена`));
                        throw new SomeError(ERR_TYPE.SMS, 'CHANGE_PROVIDER');
                    }
                    log.info(withPrefix('Ожидание смс'));
                    this.delay(delaySeconds);
                    return this.api(method, id, status, service, country, count);
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
        let cp = new SmsArea(this.apiKey, this.log, this.http);
        cp.setOnLowBalanceCb(this.onLowBalance);
        cp.setOnNoAvailableNumbersCb(this.onNoAvailableNumbers);
        return cp;
    }
}
