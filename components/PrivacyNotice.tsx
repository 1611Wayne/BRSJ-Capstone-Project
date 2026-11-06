import { useSupabaseAuth } from '@/lib/supabase/config';

// The notice RA 10173 Section 16(b) requires before personal information is entered. Each statement here describes what
// the system really does, so change this text whenever that changes (new provider, SMS sign-in, what the monthly report holds).
const heading = 'font-bold mt-6';
const list = 'list-disc pl-5 mt-2 space-y-1';

export function PrivacyNotice() {
  return <section id="privacy" className="content-card p-6 mt-6">
    <h2 className="text-xl font-bold">Privacy Notice</h2>
    <p className="text-xs text-slate-500 mt-1">Last updated: 6 November 2026</p>
    {!useSupabaseAuth && <p className="mt-3 border bg-slate-50 p-3 text-sm">This copy of the portal is a demonstration. It uses fictional records that stay in this browser tab, and closing the tab clears them. Use sample information only.</p>}
    <p className="mt-3">Barangay San Jose, Rodriguez, Rizal runs this portal and is responsible for your personal information. This notice explains what we collect, why we need it, who can see it, and your rights under the Data Privacy Act of 2012 (Republic Act No. 10173).</p>

    <h3 className={heading}>What we collect</h3>
    <ul className={list}>
      <li><strong>Your account details:</strong> name, address, mobile number, email address and password.</li>
      <li><strong>Your valid ID.</strong> A government-issued ID is sensitive personal information, so access to it is limited.</li>
      <li><strong>Your application:</strong> the clearance you are asking for and its purpose, and for a business its name, location, start date, contact number, ownership, number of employees and property owner.</li>
      <li><strong>Your supporting documents:</strong> such as a picture of the establishment, DTI or SEC documents, a contract of lease or an old clearance.</li>
      <li><strong>Your payment details:</strong> the photo of your Official Receipt, and its number, date and amount.</li>
      <li><strong>Your release and feedback:</strong> when your clearance was confirmed, the IP address used to confirm it, and any rating or comment you give.</li>
      <li><strong>Activity records:</strong> what was done on your application, by whom and when.</li>
    </ul>

    <h3 className={heading}>Why we need it</h3>
    <ul className={list}>
      <li>To confirm who you are and review your application and documents.</li>
      <li>To assess your fee under the barangay&apos;s Revenue Code and check your payment.</li>
      <li>To issue your clearance, and to let others confirm that it is genuine.</li>
      <li>To send you notices in the portal about your application.</li>
      <li>To keep records, prepare reports and allow audits.</li>
    </ul>
    <p className="mt-3">We process your information with your consent, and to carry out the barangay&apos;s functions and record-keeping duties under the law. If you do not give the information we need, we may not be able to process your application.</p>

    <h3 className={heading}>How it is handled</h3>
    <p className="mt-2">You enter your information in this portal, or Staff enter it for you at the barangay counter after telling you about this notice and recording your agreement. Staff review every application. Decisions on your application are made by people, not by the system.</p>

    <h3 className={heading}>Who can see it</h3>
    <ul className={list}>
      <li><strong>Barangay Staff and Admin</strong> who handle clearances.</li>
      <li><strong>Service providers that run this portal:</strong> Supabase, which stores our records and files in Sydney, Australia; Vercel, which hosts the website; Semaphore, a Philippine text-message service that receives your mobile number only to send you a sign-in code when you ask for one; and Cloudflare, which checks that sign-ins and registrations come from a person and not an automated program, using technical details of your browser and connection (not your account). Your information is therefore stored outside the Philippines. The barangay remains responsible for it.</li>
      <li><strong>Anyone checking a clearance,</strong> such as a bank or employer, through its QR code or reference number. They see only the reference number, clearance type, issue date and status, and not your name or address.</li>
      <li><strong>The Municipal Treasury,</strong> only through the Pre-Assessment Slip you bring there to pay.</li>
      <li><strong>Those who receive the barangay&apos;s monthly reports:</strong> its administration and the banks it reports to.</li>
      <li><strong>Government offices,</strong> when the law requires it.</li>
    </ul>
    <p className="mt-3">We do not sell your information. This portal has no advertising or tracking tools, and it uses a cookie only to keep you signed in.</p>

    <h3 className={heading}>How we protect it</h3>
    <ul className={list}>
      <li>Your information is encrypted while it travels and while it is stored.</li>
      <li>Your files are kept in private storage. Only you, Staff and Admin can open them, through links that expire within minutes.</li>
      <li>Passwords are stored in scrambled form, so nobody at the barangay can read yours.</li>
      <li>Each action on an application is logged with who did it and when.</li>
    </ul>

    <h3 className={heading}>How long we keep it</h3>
    <p className="mt-2">We keep your records only as long as the barangay needs them to meet legal, audit and government record-keeping requirements, including the rules of the National Archives of the Philippines. Your uploaded files stay in online storage until they are moved to the barangay&apos;s office computer as part of its monthly records. Records and files that are no longer required are securely disposed of.</p>

    <h3 className={heading}>Your rights</h3>
    <p className="mt-2">Under the Data Privacy Act, you have the right to:</p>
    <ul className={list}>
      <li>Be told how your personal information is being used.</li>
      <li>See your information and get a copy of it in a common electronic format.</li>
      <li>Have wrong or incomplete information corrected.</li>
      <li>Object to its use, withdraw your consent, or ask that it be blocked or removed. Records the barangay must keep by law may have to stay.</li>
      <li>Be paid damages if you are harmed by false or unlawful use of your information.</li>
      <li>File a complaint with the National Privacy Commission at <a className="underline" href="https://privacy.gov.ph" target="_blank" rel="noreferrer">privacy.gov.ph</a>.</li>
    </ul>

    <h3 className={heading}>How to reach us</h3>
    <p className="mt-2">To use any of these rights or to ask about this notice, visit the Monitoring Office at the Barangay Hall, San Jose, Rodriguez, Rizal, Monday to Friday, 8:00 AM to 5:00 PM, and ask for the barangay&apos;s Data Protection Officer.</p>
  </section>;
}
