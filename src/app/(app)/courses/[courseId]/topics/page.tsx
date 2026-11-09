import Link from "next/link";
import { RecordAction, TopicFields } from "@/components/academics";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { changeTopic, saveTopic } from "@/features/academics/actions";
import { getCourse, getTopics } from "@/features/academics/data";

export default async function Topics({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const { course, parentArchived } = await getCourse(courseId);
  const topics = await getTopics(courseId);
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const active = topics.filter((topic) => !topic.archived_at);
  const complete = active.filter((topic) => topic.completed_at).length;
  const archived = Boolean(course.archived_at || parentArchived);

  return <>
    <div className="page-head">
      <Link className="back" href={"/courses/" + courseId}>← {course.code} overview</Link>
      <h1>Topics</h1>
      <p>{course.title} · {active.length ? complete + " of " + active.length + " active topics complete" : "Not started"}</p>
      {archived && <p className="feedback">Restore this course and its location to edit topics.</p>}
    </div>
    <div className="split">
      <section className="panel">
        <h2>Course topics</h2>
        {!topics.length && <p>No topics yet.</p>}
        <ul className="record-list">
          {topics.map((topic) => {
            const parent = topic.parent_topic_id ? byId.get(topic.parent_topic_id) : null;
            return <li className="stack" key={topic.id}>
              <div className="row spread">
                <h3>{topic.title}</h3><span className="tag">{topic.archived_at ? "Archived" : topic.completed_at ? "Complete" : "Open"}</span>
              </div>
              {parent && <p>Under {parent.title}{parent.archived_at ? " (archived)" : ""}</p>}
              {!archived && <details>
                <summary>Manage topic<span className="sr-only"> {topic.title}</span></summary>
                <div className="stack">
                  <ActionForm action={saveTopic.bind(null, courseId, topic.id)}>
                    <TopicFields topics={topics} topic={topic} /><Submit>Save topic</Submit>
                  </ActionForm>
                  {!topic.archived_at && <RecordAction action={changeTopic.bind(null, courseId, topic.id)}
                    label={topic.completed_at ? "Reopen topic" : "Mark complete"} mode={topic.completed_at ? "reopen" : "complete"} />}
                  <RecordAction action={changeTopic.bind(null, courseId, topic.id)}
                    label={topic.archived_at ? "Restore topic" : "Archive topic"} mode={topic.archived_at ? "restore" : "archive"} />
                </div>
              </details>}
            </li>;
          })}
        </ul>
      </section>
      {!archived && <section className="panel">
        <h2>Add a topic</h2>
        <ActionForm action={saveTopic.bind(null, courseId, null)}>
          <TopicFields topics={topics} /><Submit>Add topic</Submit>
        </ActionForm>
      </section>}
    </div>
  </>;
}
