export default function AboutPage() {
  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold text-gray-900">About Us</h1>

      <div className="prose">
        <p className="text-lg text-gray-600 leading-relaxed">
          We are a team of writers and developers passionate about sharing knowledge
          and building great software. Our blog covers topics from web development
          to design, productivity, and beyond.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Our Mission</h2>
        <p className="text-gray-600 leading-relaxed">
          To create a platform where ideas flow freely and knowledge is accessible
          to everyone. We believe in the power of open sharing and community-driven
          content.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Contact</h2>
        <p className="text-gray-600">
          Have questions or want to contribute? Reach out to us at{' '}
          <a href="mailto:hello@blog-cms.example.com" className="text-blue-600 hover:underline">
            hello@blog-cms.example.com
          </a>
        </p>
      </div>
    </div>
  );
}
