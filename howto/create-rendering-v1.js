// How to create a rendering in Inbox Monster (Creative Rendering → Insert content → HTML).
const HTML = '<h1>Spring sale</h1><p>Save 20% this week.</p><a href="https://example.com">Shop now</a>';

export default {
  name: 'create-rendering-v1',
  baseURL: 'https://app.inboxmonster.com',
  storageState: 'auth/inboxmonster.json',
  intro: { title: 'Create a rendering', subtitle: 'Preview your email before you send it' },
  outro: { title: 'Your rendering is ready', subtitle: 'Inbox Monster' },
  steps: [
    { goto: '/design/projects', settle: 2500 },
    { chapter: 'Start a new rendering' },
    { caption: 'Open Creative Rendering and click Create Rendering' },
    { click: 'button:has-text("Create Rendering")' },
    { caption: 'Choose how to add your content' },
    { wait: 900 },
    { click: 'role=link[name="Insert content"]' },
    { click: 'role=link[name="HTML"]' },
    { chapter: 'Add your email' },
    { caption: 'Paste your email HTML' },
    { type: '#content', text: HTML, delay: 28, zoom: 1.3 },
    { caption: 'Give it a title and a subject line' },
    { type: 'xpath=//label[normalize-space()="Rendering Title"]/following::input[1]', text: 'Spring sale email', zoom: 1.5 },
    { type: 'xpath=//label[normalize-space()="Subject"]/following::input[1]', text: 'Save 20% this week', zoom: 1.5 },
    { chapter: 'Run the test' },
    { caption: 'Click Run Test' },
    { click: 'button:has-text("Run Test")', zoom: 1.6 },
    { wait: 6000, fast: true },
    { caption: 'Your rendering now appears at the top of the list', hold: 1500 },
    { zoomTo: 'text=Spring sale email', z: 1.7, hold: 2500 },
  ],
};
