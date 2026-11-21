/** @jsxRuntime classic */
// Classic JSX: Storybook 10's manager shares `react` as a global but not `react/jsx-runtime`, so the automatic
// runtime would bundle the project's own React copy into the panel and break it.
import React from 'react';
import { addons, types } from 'storybook/manager-api';
import { ADDON_ID, PANEL_ID, PANEL_TITLE } from './constants.ts';

addons.register(ADDON_ID, () => {
    addons.add(PANEL_ID, {
        type: types.PANEL,
        title: PANEL_TITLE,
        render: ({ active }) => {
            return active ? <div style={{ padding: 16 }}>No Figma results yet.</div> : null;
        },
    });
});
