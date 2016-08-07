import { ERR_TYPE } from "../common/SomeError";
import SomeError from "../common/SomeError";
import { log } from "../common/logger/Logger";
import { createTaskFromData } from "./helpers";
import taskClassByName from "./taskClassByName";
import * as _ from 'lodash';
import TaskData from '../common/collections/TaskData';
import Future from 'fibers/future';

var taskManagerInstance;

export default class TaskManager {
    constructor(logger = log) {
        this.log = logger;
        this.deserialize(TaskData.find({}).fetch());
        _.each(this.tasks, task => {
            if (task.isStarted())
                Future.task(() => task.start());
        });
        taskManagerInstance = this;
    }
    static instance() {
        return taskManagerInstance || new TaskManager();
    }

    create(taskName, params, ownerId) {
        let TaskClass = taskClassByName(taskName);
        if (!TaskClass)
            throw new SomeError(ERR_TYPE.TASK_MANAGER, 'Create: Unknown task type: {1}'.format(taskName));
        let task = new TaskClass(ownerId, params);
        let id = task.initDB();
        this.tasks.push(task);
        return id;
    }

    // helpers
    checkTaskOwnerId(id, ownerId) {
        let task = this.taskById(id);
        if (!task)
            throw new SomeError(ERR_TYPE.TASK_MANAGER, 'Resume: Task {1} not found!'.format(id));
        if (task.ownerId !== ownerId)
            throw new SomeError(ERR_TYPE.TASK_MANAGER,
                                'Resume: User {1} try to pause task {2} for user {3}'.format(ownerId, id, task.ownerId));
        return task;
    }
    taskById(id) {
        return _.find(this.tasks, { _id: id });
    }
    tasksByUser(ownerId) {
        return _.filter(this.tasks, task => task.ownerId === ownerId);
    }

    start(id, ownerId) {
        let task = this.checkTaskOwnerId(id, ownerId);
        Future.task(() => task.start());
        this.log.debug('[TaskManager] Starting task #{1}', id);
    }
    stop(id, ownerId) {
        let task = this.checkTaskOwnerId(id, ownerId);
        task.stop();
    }
    remove(id, ownerId) {
        let task = this.checkTaskOwnerId(id, ownerId);
        _.pull(this.tasks, task);
        task.remove();
    }
    pause(id, ownerId) {
        let task = this.checkTaskOwnerId(id, ownerId);
        Future.task(() => task.pause());
    }
    resume(id, ownerId) {
        let task = this.checkTaskOwnerId(id, ownerId);
        task.resume();
    }

    serialize() {
        return _.map(this.tasks, task => task.serialize());
    }
    deserialize(data) {
        this.tasks = _.map(data, item => {
            try {
                return createTaskFromData(item);
            } catch (e) {
                this.log.error('TaskManager: {1}', e.stack);
            }
        });
        this.tasks = _.compact(this.tasks);
    }
}
