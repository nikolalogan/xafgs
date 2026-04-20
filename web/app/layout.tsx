import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.scss'
import 'antd/dist/reset.css'
import '@univerjs/design/lib/index.css'
import '@univerjs/ui/lib/index.css'
import '@univerjs/sheets-ui/lib/index.css'

export const metadata: Metadata = {
  title: '西安分公司',
  description: 'Next.js + Tailwind + React Flow 11'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Script
          id="strip-doubao-translate-mark"
          strategy="beforeInteractive"
        >
          {`(() => {
            const attr = 'data-doubao-translate-traverse-mark';
            const strip = (root) => {
              if (!root || !root.querySelectorAll) return;
              root.querySelectorAll('[' + attr + ']').forEach((element) => {
                element.removeAttribute(attr);
              });
            };
            strip(document);
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === attr && mutation.target instanceof Element) {
                  mutation.target.removeAttribute(attr);
                }
                if (mutation.type === 'childList') {
                  mutation.addedNodes.forEach((node) => {
                    if (!(node instanceof Element)) return;
                    if (node.hasAttribute(attr)) node.removeAttribute(attr);
                    strip(node);
                  });
                }
              }
            });
            observer.observe(document.documentElement, {
              subtree: true,
              childList: true,
              attributes: true,
              attributeFilter: [attr],
            });
          })();`}
        </Script>
        {children}
      </body>
    </html>
  )
}
