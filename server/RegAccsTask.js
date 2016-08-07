import ResumableTask from "./lib/ResumableTask";
import { ERR_TYPE } from "../common/SomeError";
import SomeError from "../common/SomeError";
import { updateAccs } from "./AccManager";
import AccManager from "./AccManager";
import AccInfo from "../common/AccInfo";
import MultiTask from "./lib/MultiTask";
import VkAcc from "./VkApi";
import SimSms from "./SmsProviders/SimSms";
import SmsVk from "./SmsProviders/SmsVk";
import SmsLike from "./SmsProviders/SmsLike";
import SmsArea from "./SmsProviders/SmsArea";

export const UsedProxies_DB = new Meteor.Collection('UsedProxies');

export class RegAccsTaskSingle extends ResumableTask {
    constructor(parent, title) {
        super(parent.ownerId, 'RegAccsTaskSingle', parent, title);
    }

    reg(smsProvider, acc, firstName, lastName, gender, pass) {
        let { http } = acc;
        this.info('Регистрация аккаунта. Прокси {1}', _.result(acc, 'proxy.toString'));
        this.info('UserAgent: {1}', acc.getUA());

        let checkErrOnPage = response => {
            if (!response.content.contains('service_msg_warning'))
                return;
            let match = response.content.match(/service_msg_warning.*?>(.*?)<\/div>/);
            if (match)
                throw new SomeError(ERR_TYPE.TASK_LOGIC, match[1]);
            throw new SomeError(ERR_TYPE.TASK_LOGIC, 'service_msg_warning??');
        };

        let number = smsProvider.getPhone();
        this.info('Получен номер: {1}', number);

        let response = http.get('http://vk.com/join');

        response = http.postMatch('http://vk.com/join.php', 'act=finish', {
            act: 'start', al: 1, fname: firstName, lname: lastName, sex: gender
        });
        //checkErrOnPage(response);
        response = http.get(
            'http://vk.com/join.php?__query=join&_ref=join&act=finish&al=-1&al_id=0&_rndVer=' + _.random(10000)
        );
        //checkErrOnPage(response);
        let match = response.content.match(/hash\\":\\"([^\\]*)/);
        if (!match)
            throw new SomeError(ERR_TYPE.TASK_LOGIC, 'Не найден hash join.php');
        let hash = match[1], phone = /*'+7' + */number;

        // enter phone
        response = http.post('http://vk.com/join.php', {
            al: 1, act: 'phone', hash, phone
        });
        checkErrOnPage(response);
        // check captcha
        // 19102<!><!>0<!>6693<!>2<!>335673268171<!>1   =>  sid == 335673268171
        // 19102<!><!>0<!>6693<!>8<!>335673268171<!>1   =>  wrong number?
        match = response.content.match(/\d+<!><!>\d+<!>\d+<!>(\d+)/);
        if (!match)
            throw new SomeError(ERR_TYPE.TASK_LOGIC,
                                'Неизвестный формат ответа join.php: {1}'.format(response.content));
        if (match[1] == 8) { // wrong number
            this.info(`Номер ${phone} используется?? Отмена и получение нового номера`);
            smsProvider.reject();
            this.delay(10);
            return this.reg(...[].slice.call(arguments));
        }
        if (match[1] == 2) { // captcha
            match = response.content.match(/\d+<!><!>0<!>\d+<!>2<!>(\d+)<!>1/);
            let captcha_sid = match[1],
                captcha_key = acc.captcha('http://vk.com/captcha.php?sid=' + captcha_sid);
            response = http.post('http://vk.com/join.php', {
                al: 1, act: 'phone', hash, phone, captcha_key, captcha_sid
            });
        }

        //let resendUrl = `http://m.vk.com/login?act=blocked_resend&hash=${hash}`;
        let resendSms = () => {
            http.post('http://vk.com/join.php', {act: 'resend', al: 1, hash})
        };
        //this.debug('Повтор отправки смс: {1}', resendUrl);

        let code = smsProvider.getSms(resendSms);
        this.debug('Получен код: {1}', code);
        response = http.post('https://login.vk.com/?act=check_code&_origin=http://vk.com', {
            code, email: phone
        });
        //checkErrOnPage(response);
        if (response.content.contains('top.Join.codeFailed(2)'))
            throw new SomeError(ERR_TYPE.SMS, 'Неверный код');
        match = response.content.match(/askPassword\('(.*?)'/);
        if (!match)
            throw new SomeError(ERR_TYPE.TASK_LOGIC, 'Не найден askPassword');
        let join_hash = match[1];

        // pass
        response = http.get('http://vk.com/join?act=finish');

        let parseInputValByName = name => {
            let re = new RegExp(`<input.*?name="${name}".*?>`);
            let matchInput = response.content.match(re);
            if (!matchInput)
                throw new SomeError(ERR_TYPE.TASK_LOGIC, `Не найден ${name} act=finish`);
            let result = matchInput[0].match(/value="([^"]+)"/);
            if (!result)
                throw new SomeError(ERR_TYPE.TASK_LOGIC, `Не найден value ${name} act=finish`);
            return result[1];
        };
        let ip_h = parseInputValByName('ip_h');
        let lg_h = parseInputValByName('lg_h');
        response = http.post('https://login.vk.com/?act=login', {
            _origin: 'http://vk.com', act: 'login', role: 'al_frame', email: phone, ip_h, lg_h,
            join_code: code, join_hash, join_to_already: 0, pass
        });


        response = http.get('http://vk.com/join?act=school');
        match = response.content.match(/hash":"([^"]*)/);
        if (!match)
            throw new SomeError(ERR_TYPE.TASK_LOGIC, 'Не найден hash act=school');
        hash = match[1];

        let rand = _.random(10000);
        response = http.get('http://vk.com/join?act=university');
        response = http.get('http://vk.com/join.php?__query=join&_ref=join&act=university&al=-1&_rndVer=' + rand);
        response = http.get('http://vk.com/join?act=import');
        response = http.get('http://vk.com/join.php?__query=join&_ref=join&act=import&al=-1&_rndVer=' + rand);

        response = http.post('http://vk.com/join.php', {
            act: 'import_complete', al: 1, hash
        });

        acc.login = number;
        acc.pass = pass;
        let result = updateAccs([acc.serialize()], this.ownerId);
        if (result[acc.login].state != 'OK')
            throw new SomeError(ERR_TYPE.TASK_LOGIC,
                                'Ошибка при добавлении {1}:{2} в базу: {3}'.format(acc.login, acc.pass, result));

    }

    regTry(...params) {
        do {
            var provider = this.chooseSmsProvider();
            if (!provider) {
                this.info('Нет доступных сервисов');
                this.delay(60);
            }
        } while (!provider);

        let onLowBalance = self => {
            let actualProvider = this.chooseSmsProvider();
            if (actualProvider && actualProvider.getName() != self.getName())
                throw new SomeError(ERR_TYPE.SMS, 'CHANGE_PROVIDER');
        };
        provider.setOnLowBalanceCb(onLowBalance);
        provider.setOnNoAvailableNumbersCb(onLowBalance);

        this.info('Используется сервис {1}', provider.getName());
        let clone = provider.clone();
        try {
            this.reg(clone, ...params);
        } catch (e) {
            if (e.name == ERR_TYPE.SMS && e.message == 'CHANGE_PROVIDER') {
                this.info('СМС не пришло. Отклоняем номер, получаем новый.');
                clone.reject();
                return this.regTry(...params);
            }
            throw e;
        }
    }

    markProxyAsUsed(proxy) {
        if (!proxy.ip) return;
        UsedProxies_DB.insert({ ownerId: this.ownerId, date: +new Date(), ip: proxy.ip });
    }

    regMulti(n) {
        let { firstNames, lastNames, gender, pass } = this.params;
        let mngr = new AccManager(this.ownerId);
        let { filteredProxies } = this.parent;
        this.accs = this.accs || [];
        _.defaults(this.state, { i: 0, n });
        for (let i = this.state.i; i < n; this.setState({ i: ++i })) {
            let proxy = _.sample(filteredProxies), acc = new VkAcc();
            acc.proxy = proxy;

            if (!_.size(filteredProxies))
                throw new SomeError(ERR_TYPE.TASK_WRONG_PARAM,
                                    'Закончились прокси! В базе {1} использованных прокси'
                                        .format(UsedProxies_DB.find({ownerId: this.ownerId}).count()));
            _.pull(filteredProxies, proxy);
            this.markProxyAsUsed(proxy);

            acc.http.log = acc.log = this.log;
            acc.ruCaptchaKey = mngr.getRuCaptchaKey();
            this.acc = acc;

            this.info('Использутся прокси {1}', proxy.ip);
            this.regTry(acc, _.sample(firstNames), _.sample(lastNames), gender, pass);
            this.info('Аккаунт {1}/{2} зарегистрирован. Тест.', i + 1, n);
            acc.authTry();
            this.accs.push(acc);
        }
    }

    chooseSmsProvider() {
        let providers = this.smsProviders, sorted = _.sortBy(providers, provider => provider.cost());
        return _.find(sorted, provider => {
            try {
                let balance = provider.getBalance();
                this.info('[{1}] Баланс: {2}', provider.getName(), balance);
                if (balance < provider.cost()) {
                    this.info('[{1}] Мало денег - пропуск', provider.getName());
                    return false;
                }
                let availableCnts = provider.getAvailableCnts();
                this.info('[{1}] Доступных активаций: {2}', provider.getName(), availableCnts);
                return availableCnts;
            } catch (e) {
                this.error('checkSmsProvidersInfo: {1}', e.message);
                this.error('checkSmsProvidersInfo: {1}', e.stack);
                return false;
            }
        });
    }

    start() {
        super.start();
        this.wrapErrHandlers(() => {
            let { useSimSms, useSmsVk, useSmsLike, useSmsArea,
                  simSmsKey, smsVkKey, smsLikeKey, smsAreaKey } = this.params;
            let { totalCnt, poolSize } = this.params;

            this.smsProviders = [];
            if (useSimSms)  this.smsProviders.push(new SimSms(simSmsKey, this.log));
            if (useSmsVk)   this.smsProviders.push(new SmsVk(smsVkKey, this.log));
            if (useSmsLike) this.smsProviders.push(new SmsLike(smsLikeKey, this.log));
            if (useSmsArea) this.smsProviders.push(new SmsArea(smsAreaKey, this.log));

            if (_.last(this.parent.tasks) == this)
                var cnt = Math.floor(totalCnt / poolSize);
            else
                cnt = Math.ceil(totalCnt / poolSize);
            this.regMulti(cnt);
        });
    }

    serialize() {
        return _.merge(super.serialize(), {
            accs: _.map(this.accs, acc =>
                _.pick(acc.serialize(), ['login', 'pass', 'proxy', 'state'])
            )
        });
    }
    deserialize(data) {
        super.deserialize(data);
        this.accs = _.map(data.accs, accData => new AccInfo().deserialize(accData));
        let mngr = new AccManager(this.ownerId);
        _.each(this.accs, acc => {
            acc.ruCaptchaKey = mngr.getRuCaptchaKey();
        });
    }
}

export default class RegAccsTask extends MultiTask {
    constructor(ownerId, params) {
        super(ownerId, 'RegAccsTask', params, RegAccsTaskSingle);
    }

    checkSmsProvidersInfo() {
        let { useSimSms, useSmsVk, useSmsLike, useSmsArea, simSmsKey,
              smsVkKey, smsLikeKey, smsAreaKey } = this.state.params, smsProviders = [];
        if (simSmsKey/* && useSimSms*/)
            smsProviders.push(new SimSms(simSmsKey, this.log));
        if (smsVkKey /*&& useSmsVk*/)
            smsProviders.push(new SmsVk(smsVkKey, this.log));
        if (smsLikeKey /*&& useSmsLike*/)
            smsProviders.push(new SmsLike(smsLikeKey, this.log));
        if (smsAreaKey /*&& useSmsArea*/)
            smsProviders.push(new SmsArea(smsAreaKey, this.log));
        _.each(smsProviders, smsProvider => {
            try {
                this.setState({
                    smsProviders: {
                        [smsProvider.getName()]: {
                            balance: smsProvider.getBalance(),
                            availableCnts: smsProvider.getAvailableCnts()
                        }
                    }
                });
            } catch (e) {
                this.error('checkSmsProvidersInfo: {1}', e.message);
                this.error('checkSmsProvidersInfo: {1}', e.stack);
            }
        });
    }
    startTimers() {
        this.checkSmsProvidersInfo();
        this.checkIntervalId = Meteor.setInterval(
            Meteor.bindEnvironment(this.checkSmsProvidersInfo.bind(this)),
        20 * 1000);
    }
    stopTimers() {
        Meteor.clearInterval(this.checkIntervalId);
    }

    startNow() {
        try {
            this.tasks.forEach(task => task.params = this.state.params);

            let proxies  = _.map(this.state.params.proxies, s => new Proxy(s));
            this.filteredProxies = this.filterProxies(proxies);
            this.info('Фильтрация прокси: {1}/{2}', _.size(this.filteredProxies), _.size(proxies));

            super.startNow();
            this.waitChildrenAndPrint();
        } catch (e) {
            this.error('>>>>>>>>>>>>>>>> TASK EXCEPTION: {1}', e.stack);
            this.finished(e.message);
        }
    }

    filterProxies(proxies) {
        proxies = _.uniqBy(proxies, p => p.ip);
        let IPs = _.map(proxies, 'ip');
        let IPs_DB = UsedProxies_DB.find({ ownerId: this.ownerId, ip: { $in: IPs } }).fetch();
        let filterFunc = item => moment().diff(item.date, 'days') < 1;
        let oldItems = _.reject(IPs_DB, filterFunc);
        if (_.size(oldItems))
            UsedProxies_DB.remove({ ownerId: this.ownerId, _id: { $in: _.map(oldItems, '_id') } });
        let toFilterIPs = IPs_DB.filter(filterFunc);
        proxies = _.differenceWith(proxies, toFilterIPs, (proxy, item) => proxy.ip == item.ip);
        return proxies;
    }
}
