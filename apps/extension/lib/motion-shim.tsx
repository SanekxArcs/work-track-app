import { createElement, Fragment, type ComponentType, type ReactNode } from 'react'

type MotionProps = Record<string, unknown> & { children?: ReactNode }
type MotionMap = {
  article: ComponentType<MotionProps>
  div: ComponentType<MotionProps>
  section: ComponentType<MotionProps>
  span: ComponentType<MotionProps>
}

const motionOnlyProps = new Set([
  'animate', 'exit', 'initial', 'layout', 'layoutId', 'transition',
  'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'viewport'
])

function createMotionElement(tag: string): ComponentType<MotionProps> {
  return function MotionElement({ children, ...props }: MotionProps): React.JSX.Element {
    for (const prop of motionOnlyProps) delete props[prop]
    return createElement(tag, props, children)
  }
}

// Plasmo's Parcel runtime can load the desktop animation package without its
// DOM factory on some pages. Use concrete elements instead of a dynamic Proxy:
// content-script module environments can otherwise expose `motion` without a
// resolved `.div` property on pages such as Slack.
export const motion: MotionMap = {
  article: createMotionElement('article'),
  div: createMotionElement('div'),
  section: createMotionElement('section'),
  span: createMotionElement('span')
}

export function AnimatePresence({ children }: MotionProps): React.JSX.Element {
  return <Fragment>{children}</Fragment>
}
