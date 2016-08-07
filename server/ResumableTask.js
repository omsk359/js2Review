import { ERR_TYPE } from "../../common/SomeError";
import { TaskRunStates } from "../../common/types";
import SomeError from "../../common/SomeError";
import TaskLogger, { SubTaskLogger } from "../../common/logger/server/TaskLogger";
import Future from 'fibers/future';
import TaskData from '../../common/collections/TaskData';

export default class ResumableTask {
    constructor(ownerId, taskName, parent, title, params) {
        this.ownerId = ownerId;
        this.taskName = taskName;
        this.initParams = params;
        this.parent = parent;
        if (this.parent) {
            this.title = title;
            this._id = `${parent._id}#${this.title}`;
            this.ownerId = parent.ownerId;
            this.init();
        }
        this.state = {};
        this.state.runState = TaskRunStates.INIT;
        this.eventEmitter = new (Npm.require('events').EventEmitter);
    }
    newTaskInit(params) {}

    init() { // run it after construct (with _id) or restoreState
        this.log = this.parent ? new SubTaskLogger(this) : new TaskLogger(this);
    }
    saveState() {
        if (this.parent)
            return this.parent.saveState();
        TaskData.update(this._id, { $set: { data: this.serialize() } });
    }
    initDB() {
        if (this.parent) return;
        this.state.params = this.initParams;
        let taskData = {
            data: this.serialize(),
            createdAt: +new Date(),
            ...this.getMetaData()
        };
        this._id = TaskData.insert(taskData);
        this.init();
        this.debug('[ownerId {3}] Init new task {1} #{2}', this.taskName, this._id, this.ownerId);

        try {
            this.newTaskInit(this.initParams);
        } catch (e) {
            TaskData.remove(this._id);
            throw e;
        }
        return this._id;
    }

    restoreState(taskData) {
        if (!this.parent && !_.get(taskData, '_id'))
            taskData = TaskData.findOne({ _id: this._id });
        if (!taskData)
            return;
        this.setMetaData(taskData);
        this.init(); // init log before deserialize!
        this.deserialize(taskData.data);
    }
    setState(params) {
        _.merge(this.state, params);
        this.saveState();
    }
    getMetaData() {
        return _.pick(this, ['_id', 'taskName', 'ownerId', 'title']);
    }
    setMetaData(metaData) {
        _.assign(this, _.pick(metaData, ['_id', 'taskName', 'ownerId', 'title']));
    }
    removeState() {
        if (this.parent) return;
        TaskData.remove({ _id: this._id, ownerId: Meteor.userId() });
        this.state = {};
        this._id = null;
    }

    pauseHook() {
        if (this.isPaused()) {
            let pauseFuture = new Future();
            let cb = () => pauseFuture.isResolved() || pauseFuture.return();
            this.eventEmitter.once(TaskRunStates.RESUME, cb);
            this.eventEmitter.once(TaskRunStates.STOPPED, cb);
            pauseFuture.wait();
        }
        if (this.isStopped() || this.isFinished())
            throw new SomeError(ERR_TYPE.TASK_STOP_EVENT);
    }
    
    startTimers() {}
    stopTimers() {}
    start() {
        if (!this._id && !this.parent)
            this.initDB();
        this.setState({ runState: TaskRunStates.STARTED });
        this.startTimers();
    }
    stop() {
        this.setState({ runState: TaskRunStates.STOPPED });
        this.eventEmitter.emit(TaskRunStates.STOPPED);
        this.stopTimers();
    }
    pause() {
        if (this.state.runState != TaskRunStates.STARTED && this.state.runState != TaskRunStates.WAIT)
            return;
        this.setState({ runState: TaskRunStates.PAUSED });
        this.eventEmitter.emit(TaskRunStates.PAUSED);
        this.stopTimers();
    }
    resume() {
        this.setState({ runState: TaskRunStates.STARTED });
        this.eventEmitter.emit(TaskRunStates.RESUME);
        this.startTimers();
    }
    remove() {
        if (this.state.runState == TaskRunStates.STARTED || this.state.runState == this.state.runState.PAUSED) {
            this.info('Нельзя удалять незавершенную задачу');
            return;
        }
        this.state.runState = TaskRunStates.STOPPED;
        this.eventEmitter.emit(TaskRunStates.STOPPED);
        this.removeState();
        this.clear();
    }
    setWait() {
        this.setState({ runState: TaskRunStates.WAIT });
    }
    clear() {
        this.log.clear();
    }
    finished(exitState) {
        this.setState({ runState: TaskRunStates.FINISHED });
        this.eventEmitter.emit(TaskRunStates.FINISHED, exitState);
        this.stopTimers();
    }
    isWait()     { return this.state.runState == TaskRunStates.WAIT; }
    isPaused()   { return this.state.runState == TaskRunStates.PAUSED; }
    isStarted()  { return this.state.runState == TaskRunStates.STARTED; }
    isStopped()  { return this.state.runState == TaskRunStates.STOPPED; }
    isFinished() { return this.state.runState == TaskRunStates.FINISHED; }

    serialize() {
        return { state: this.state };
    }
    deserialize(data) {
        this.state = data.state;
    }
    printState() {
        this.debug('[ownerId {4}] [{2}#{3}] state: {1}', this.serialize(), this.taskName, this._id, this.ownerId);
    }

    wrapErrHandlers(func) {
        var exitState;
        try {
            func.apply(this);
            exitState = 'OK';
        } catch (e) {
            switch (e.name) {
                case ERR_TYPE.PROXY:
                case ERR_TYPE.AUTH:
                    return exitState = e.message;
                case ERR_TYPE.TASK_TIMEOUT:
                    return exitState = e.name;
                case ERR_TYPE.TASK_STOP_EVENT:
                    this.debug('TASK STOP');
                    return exitState = 'OK';
            }
            exitState = e.message || e;
            this.error('e: {1}', e.stack);
            this.error('e: {1}', exitState);
            //throw e;
        } finally {
            if (exitState == 'OK')
                this.info('Закончили!');
            else
                this.error(exitState);
            this.finished(exitState);
        }
    }

    debug(...args)  { this.log.debug(...args) }
    info(...args)   { this.log.info(...args); }
    error(...args)  { this.log.error(...args); }

    delay(sec, noMsg = false) {
        if (!noMsg)
            this.info(`Пауза ${sec} сек.`);
        Meteor._sleepForMs(sec * 1000);
    }
}
