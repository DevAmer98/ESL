/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a minimal self-contained server for the Docker runtime stage.
  output: "standalone",
};

export default nextConfig;
