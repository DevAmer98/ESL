import "./globals.css";

export const metadata = {
  title: "Frostline · ESL console",
  description: "Manage Minew DS026F labels through a G1-E gateway",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
