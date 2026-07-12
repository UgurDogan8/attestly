import React from 'react';
import { Box, Heading, Icon, Inline, Stack, Text, xcss } from '@forge/react';
import type { IconProps } from '@forge/react';

export interface SurfaceHeaderProps {
  icon: IconProps['glyph'];
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

const iconBoxStyles = xcss({ borderRadius: 'radius.medium' });

/**
 * Shared header treatment (2026-07-12 UI pass) for every top-level Attestly
 * surface — dashboard, drill-down, settings — so the app reads as one
 * product rather than four independently-styled screens: a brand-blue icon
 * badge, a title, and an optional one-line subtitle, with room for a
 * page-level action (e.g. "Export") at the trailing edge. Mirrors the same
 * icon-badge-plus-title pattern used on the Custom UI export page
 * (`static/export-ui`) — that surface can't share this component directly
 * (no React there, `@forge/react` is UI-Kit-only), so the visual language
 * is kept in sync by convention, not by shared code.
 */
export function SurfaceHeader({ icon, title, subtitle, action }: SurfaceHeaderProps): React.JSX.Element {
  return (
    <Inline space="space.200" alignBlock="center" spread="space-between">
      <Inline space="space.150" alignBlock="center">
        <Box backgroundColor="color.background.brand.bold" padding="space.100" xcss={iconBoxStyles}>
          <Icon glyph={icon} label="" color="color.text.inverse" size="small" />
        </Box>
        <Stack space="space.025">
          <Heading size="medium">{title}</Heading>
          {subtitle ? <Text color="color.text.subtle">{subtitle}</Text> : null}
        </Stack>
      </Inline>
      {action ?? null}
    </Inline>
  );
}
