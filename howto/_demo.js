// Smoke test for the studio against a local page. Not a real how-to.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export default {
  name: '_demo',
  intro: { title: 'Create a project', subtitle: 'Demo studio test' },
  outro: { title: 'That’s it', subtitle: 'Thanks for watching' },
  steps: [
    { goto: pathToFileURL(path.resolve('demo/app.html')).href },
    { chapter: 'Fill in the details' },
    { caption: 'Give the project a title' },
    { type: '#t', text: 'Spring campaign' },
    { caption: 'Then add a subject line' },
    { type: '#s', text: 'Hello from the studio' },
    { chapter: 'Create it' },
    { caption: 'Click Create' },
    { click: '#go' },
    { waitFor: '#done' },
    { caption: 'Done!', hold: 1500 },
  ],
};
