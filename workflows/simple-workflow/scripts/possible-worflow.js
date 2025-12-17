import { agent, initialPrompt, memory } from 'agent-state-machine';
import emailHuman from './scripts/emailHuman.js';

const email = await initialPrompt('What is your name and email?');
const clarifications = await agent('ask-for-clarification');

const phases = await buildRoadmap();

phases.forEach(async (phase) => {
    const tasks = await buildTaskList(phase);
    tasks.forEach(async (task) => {
        await implementTask(task);
    });
});

async function buildRoadmap() {
    const roadmap = await agent('create-phased-roadmap', {
        initialPrompt,
        clarifications
    });
    await agent('review-roadmap', roadmap);
    await agent('security-review', roadmap);
    if(!memory.roadmapApproved) {
        return buildRoadmap();
    }

    
    await emailHuman(email, 'Roadmap approved!')
    return roadmap.phases;
}

async function buildTaskList(phase) {
    const tasks = await agent('build-task-list', phase);
    await agent('review-task-list', tasks);
    await agent('security-review', tasks);
    if(!memory.taskListApproved) {
        return buildTaskList(phase);
    }
    return tasks;
}

async function implementTask(task) {
    const steering = await agent('collect-steering', task);
    const code = await agent('code-builder', steering);
    await agent('review-code', code);
    await agent('security-review', code);
    if(!memory.changesApproved) {
        return implementTask(task);
    }
}

// await agent({
//     name: 'test-two',
//     agent: 'low',
//     instructions: 'Do something'
// });

// await agent({
//     name: 'test-two',
//     agent: 'low',
//     instructions: 'Do something'
// });