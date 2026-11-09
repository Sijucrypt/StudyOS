"use client";

import { useState } from "react";
import type { StudyTopic } from "@/features/planner/data";

export function StudySessionScope({ scope, courses, topics, initialCourse, initialTopic }: {
  scope: string | null; courses: { id: string; label: string }[]; topics: StudyTopic[];
  initialCourse?: string | null; initialTopic?: string | null;
}) {
  const [course, setCourse] = useState(scope ?? initialCourse ?? "");
  const options = topics.filter((topic) => topic.course_id === course);
  return <div className="fields">
    {!scope && <label>Course
      <select name="course_id" value={course} onChange={(event) => setCourse(event.target.value)}>
        <option value="">General study</option>
        {courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>}
    <label>Topic (optional)
      <select name="topic_id" key={course} disabled={!course} defaultValue={course === initialCourse ? initialTopic ?? "" : ""}>
        <option value="">{course ? "No topic" : "Choose a course first"}</option>
        {options.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
      </select>
    </label>
  </div>;
}
