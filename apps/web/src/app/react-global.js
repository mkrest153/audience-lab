// The screens use React as a global (like the published prototype); the
// bundle provides it before any screen module runs.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';

window.React = React;
window.ReactDOM = ReactDOM;
