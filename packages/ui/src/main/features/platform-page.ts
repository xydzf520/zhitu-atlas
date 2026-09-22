/** Minimal page capability contract used by Atlas readers and the native reply adapter. */
export interface PageControl {
  click(): Promise<void>
  type(text: string, options?: { delay?: number }): Promise<void>
}
export interface BrowserPage {
  isClosed(): boolean
  url(): string
  evaluate<T, A extends unknown[]>(fn: (...args: A) => T, ...args: A): Promise<Awaited<T>>
  evaluateHandle(
    fn: (target: string) => unknown,
    target: string
  ): Promise<{ asElement(): PageControl | null }>
  $(selector: string): Promise<PageControl | null>
  on(event: string, callback: (...args: any[]) => void): unknown
  once(event: string, callback: (...args: any[]) => void): unknown
  off(event: string, callback: (...args: any[]) => void): unknown
}
export type ElementHandle = PageControl
