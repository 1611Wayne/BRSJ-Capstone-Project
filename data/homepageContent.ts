export const applicationSteps = [
  { title: 'Choose Clearance', description: 'Select the clearance you need from our 13 available services.' },
  { title: 'Submit Requirements', description: 'Complete the form and upload your documents. Staff will review your request and prepare the assessment.' },
  { title: 'Pay at Treasury / Enter OR', description: 'After assessment, pay at the Municipal Treasury. Return to the portal to enter your Official Receipt details.' },
  { title: 'Download Clearance', description: 'Download your available clearance and confirm receipt to close your request.' },
];

export const portalBenefits = [
  { title: 'Apply Online', description: 'Prepare your application and submit requirements from home.', href: '/resident/apply' },
  { title: 'Transparent Assessment', description: 'See the assessed fee breakdown before visiting the Treasury.', href: '#faq-assessment' },
  { title: 'Track Status', description: 'Follow your request and see what you need to do next.', href: '/track' },
  { title: 'Download Clearance', description: 'Access your clearance from your account once it is ready.', href: '/resident/applications' },
];

export const homepageFAQs = [
  { id: 'faq-apply', question: 'How do I apply for a clearance?', answer: 'Register or log in, choose one of the 13 clearance types, complete the application form, and upload the required documents. After you submit, your request will be marked Pending Assessment for Staff review.' },
  { id: 'faq-documents', question: 'What documents can I upload?', answer: 'Upload clear JPG, PNG, or PDF files, up to 5 MB each. Required documents appear in the application form and depend on your clearance type. A Business Clearance renewal requires the old clearance, and renters must also provide a contract of lease.' },
  { id: 'faq-assessment', question: 'How will I know how much to pay?', answer: 'Staff reviews your requirements and completes the assessment. When your status changes to Awaiting OR, open My Applications to view the fee breakdown and download your Pre-Assessment Slip.' },
  { id: 'faq-payment', question: 'Can I pay through this portal?', answer: 'Payments are made at the Municipal Treasury. The portal does not collect payments or issue Official Receipts. After paying, upload a photo of the receipt issued by the Treasury. Staff will review it and record the OR number before verifying payment.' },
  { id: 'faq-tracking', question: 'How do I track my application?', answer: 'Select Track Application and log in to your account. My Applications shows your requests, their current status, and available actions. Full application details are not displayed publicly.' },
  { id: 'faq-download', question: 'When can I download my clearance?', answer: 'Once Staff has verified your payment and your status is Ready for Download, open your request to download the clearance PDF. After downloading, select Confirm Receipt. You can then rate your experience or skip feedback.' },
];
