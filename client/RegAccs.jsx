import React from 'react';
import * as _ from 'lodash';
import store from '../../redux/store';
import { log } from "../../../common/logger/Logger";
import { Actions } from "../../redux/actions";
import AccManager from "../../AccManager";
import { omitUndef } from "../../../common/helpers";
import { createContainer } from 'meteor/react-meteor-data';
import { TasksCreatorRefs } from "./TasksCreator";
import UserAccs from '../../../common/collections/UserAccs';
import { CheckBoxWithFields } from "../helpers";
import { CreateTaskBtns } from "./TasksCreator";
import { getUserData, setUserData } from "../../helpers";
import { TextField, DropDownMenu, MenuItem } from 'material-ui';
import { ItemsSelect } from '../helpers';

export default class RegAccsTaskDumb extends React.Component {
    create() {
        let params = _.pick(this.props, ['taskScheduler', 'useSimSms', 'useSmsVk', 'useSmsLike',
                                         'useSmsArea', 'poolSize', 'firstNames', 'lastNames',
                                         'gender', 'pass', 'totalCnt', 'proxies']);
        _.assign(params, _.pick(this.props.settings, ['simSmsKey', 'smsVkKey', 'smsLikeKey', 'smsAreaKey']));
        this.props.onCreate(params);
    }
    getSettings() {
        let settings = {
            simSmsKey:  _.result(this.refs.simSmsKey, 'getValue'),
            smsVkKey:   _.result(this.refs.smsVkKey, 'getValue'),
            smsLikeKey: _.result(this.refs.smsLikeKey, 'getValue'),
            smsAreaKey: _.result(this.refs.smsAreaKey, 'getValue')
        };
        return omitUndef(_.defaults(settings, this.props.settings));
    }
    changed() {
        let settings = this.getSettings();
        this.props.onSave(settings);
        let params = {
            useSimSms:  _.result(this.refs.useSimSms, 'isChecked'),
            useSmsVk:   _.result(this.refs.useSmsVk, 'isChecked'),
            useSmsLike: _.result(this.refs.useSmsLike, 'isChecked'),
            useSmsArea: _.result(this.refs.useSmsArea, 'isChecked'),
            poolSize:   +_.result(this.refs.poolSize, 'getValue'),
            totalCnt:   +_.result(this.refs.totalCnt, 'getValue'),
            pass:       _.result(this.refs.pass, 'getValue'),
            proxies:    this.props.proxies
        };
        store.dispatch(Actions.regAccsTC.setParams(params));
    }
    render() {
        if (this.props.loading) return <div />;
        const { simSmsKey, smsVkKey, smsLikeKey, smsAreaKey } = this.props.settings;
        const { switchTo, useSimSms, useSmsVk, useSmsLike, useSmsArea, firstNames,
                lastNames, poolSize, gender, pass, totalCnt, proxies } = this.props;
        const isReadyCreate = () => (useSimSms && _.size(simSmsKey) > 5 ||
                                     useSmsVk && _.size(smsVkKey) > 5 ||
                                     useSmsLike && _.size(smsLikeKey) > 5 ||
                                     useSmsArea && _.size(smsAreaKey) > 5
                                    ) && poolSize > 0 && totalCnt > 0 && pass.length > 0
                                      && _.size(firstNames) && _.size(lastNames);
        return (
            <div>
                <div className="reg-accs-top">
                    <div className="reg-accs-fields">
                        <div>Зарегистрировать аккаунтов:
                            <TextField ref="totalCnt" defaultValue={totalCnt} type="number"
                                       className="num-range-field" onChange={() => this.changed()} />
                        </div>
                        <div>Одновременных регистраций:
                            <TextField ref="poolSize" defaultValue={poolSize} type="number"
                                       className="num-range-field" onChange={() => this.changed()} />
                        </div>
                        <div>Пароль:
                            <TextField ref="pass" className="reg-accs-pass" defaultValue={pass}
                                       onChange={() => this.changed()} />
                        </div>
                        <div>Пол:
                            <DropDownMenu value={gender} ref="gender"
                                          onChange={(e, i, item) =>
                                              store.dispatch(Actions.regAccsTC.setParams({gender: item}))
                                          }>
                                <MenuItem value={1} primaryText='Женский' />
                                <MenuItem value={2} primaryText='Мужской' />
                            </DropDownMenu>
                        </div>
                    </div>
                    <div className="reg-accs-selects">
                        <ItemsSelect items={proxies} itemName="прокси"
                                     onEdit={() => switchTo(TasksCreatorRefs.RegAccsProxiesEdit)}
                                     onChange={() => this.changed()} />
                        <br />
                        <ItemsSelect items={firstNames} itemName="имен"
                                     onEdit={() => switchTo(TasksCreatorRefs.RegAccsFirstNames)} />
                        <ItemsSelect items={lastNames} itemName="фамилий"
                                     onEdit={() => switchTo(TasksCreatorRefs.RegAccsLastNames)} />
                    </div>
                </div>
                <hr />

                <CheckBoxWithFields ref="useSimSms" defaultChecked={useSimSms} label="simsms.org"
                                    onChange={() => this.changed()}>
                    <TextField ref="simSmsKey" defaultValue={simSmsKey} hintText="Ключ API"
                               onChange={() => this.changed()} />
                </CheckBoxWithFields>
                <CheckBoxWithFields ref="useSmsVk" defaultChecked={useSmsVk} label="smsvk.net"
                                    onChange={() => this.changed()}>
                    <TextField ref="smsVkKey" defaultValue={smsVkKey} hintText="Ключ API"
                               onChange={() => this.changed()} />
                </CheckBoxWithFields>
                <CheckBoxWithFields ref="useSmsLike" defaultChecked={useSmsLike} label="smslike.ru"
                                    onChange={() => this.changed()}>
                    <TextField ref="smsLikeKey" defaultValue={smsLikeKey} hintText="Ключ API"
                               onChange={() => this.changed()} />
                </CheckBoxWithFields>
                <CheckBoxWithFields ref="useSmsArea" defaultChecked={useSmsArea} label="sms-area.org"
                                    onChange={() => this.changed()}>
                    <TextField ref="smsAreaKey" defaultValue={smsAreaKey} hintText="Ключ API"
                               onChange={() => this.changed()} />
                </CheckBoxWithFields>
                <CreateTaskBtns {...this.props} onCreate={() => this.create()} isReadyCreate={isReadyCreate}
                                onChangeScheduler={taskScheduler =>
                                    store.dispatch(Actions.regAccsTC.setParams({taskScheduler}))
                                } />
            </div>
        )
    }
}
RegAccsTaskDumb.propTypes = {
    onCreate: React.PropTypes.func.isRequired,
    onSave: React.PropTypes.func.isRequired,
    settings: React.PropTypes.object.isRequired
};

const RegAccsTask = createContainer(() => {
    const userDataHandle = Meteor.subscribe('userData');
    const loading = !userDataHandle.ready();
    return {
        loading,
        settings: loading ? {} : getUserData('userSettings') || {},
        proxies:  loading ? [] : AccManager.getAllProxies().map(proxy => proxy.toString()),
        onSave:   settings => setUserData('userSettings', settings)
    };
}, RegAccsTaskDumb);

export default RegAccsTask

export function getAllProxies() {
    return store.dispatch(Actions.accManager.load()).then(lists => {
        return UserAccs.find({}).fetch().then(accs => {
            return _.map(accs, acc => new Proxy().deserialize(acc.proxy).toString());
        });
    });
}
