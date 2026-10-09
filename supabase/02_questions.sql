-- =====================================================================
--  Question bank — full-stack technical assessment (30 minutes)
--  Run this file SECOND, after 01_schema.sql. Safe to re-run: it
--  updates stages and questions but keeps candidates and answers.
--
--  Each candidate draws (default settings, 35 questions, 56 points):
--    Stage 1  Web and tools          4 choice x 1 pt
--    Stage 2  Databases and SQL      4 choice x 1 pt
--    Stage 3  Code reading           5 choice x 1 pt   (one per language)
--    Stage 4  Frameworks             5 choice x 1 pt   (one per language)
--    Stage 5  Design and algorithms  6 choice x 1 pt   (3 design, 3 algorithms)
--    Stage 6  Debugging              4 choice x 2 pts + 1 written fix (5 pts)
--    Stage 7  Security               4 choice x 2 pts + 1 written fix (5 pts)
--    Stage 8  Problem solving        1 coding task (6 pts), any language
--  Change the counts in the back office (Test settings) or in the stages table.
--
--  lang values: general, sql, design, algorithms, js (JavaScript/TypeScript),
--  java, csharp, php, python, any (candidate picks the language)
-- =====================================================================

-- ---------------------------------------------- upgrade from the 7-stage version
-- Allows the design and algorithms categories.
alter table public.questions drop constraint if exists questions_lang_check;
alter table public.questions add constraint questions_lang_check
  check (lang in ('general', 'sql', 'design', 'algorithms', 'js', 'java', 'csharp', 'php', 'python', 'any'));

-- Draws general topics for everyone, and language questions from the candidate's stacks.
create or replace function private.draw(p_id uuid)
returns void
language plpgsql
as $$
declare
  v_stacks text[];
begin
  select stacks into v_stacks from public.candidates where id = p_id;
  delete from public.assignments where candidate_id = p_id;

  insert into public.assignments (candidate_id, question_id, step, position)
  select p_id, x.id, x.stage,
         row_number() over (partition by x.stage order by (x.kind = 'code'), x.shuffle)
  from (
    select r.id, r.stage, r.kind, random() as shuffle,
           row_number() over (partition by r.stage, r.kind order by r.lang_rank, random()) as k
    from (
      select q.id, q.stage, q.kind,
             row_number() over (partition by q.stage, q.kind, q.lang order by random()) as lang_rank
      from public.questions q
      where q.active
        and (q.lang not in ('js', 'java', 'csharp', 'php', 'python') or q.lang = any(v_stacks))
    ) r
  ) x
  join public.stages s on s.step = x.stage
  where (x.kind = 'choice' and x.k <= s.choice_count)
     or (x.kind = 'code'   and x.k <= s.code_count);
end;
$$;
revoke all on function private.draw(uuid) from public;

-- Moves Debugging, Security and Problem solving one stage later to make room
-- for the new stage 5. Runs only once; existing candidates are updated too.
do $$
begin
  if exists (select 1 from public.questions where id = 'd_js_await' and stage = 5) then
    update public.stages set step = step + 10 where step >= 5;
    update public.stages set step = step - 9 where step >= 15;
    update public.assignments set step = step + 1 where step >= 5;
    update public.candidates set current_step = current_step + 1 where current_step between 5 and 20;
    update public.candidates c
       set step_times = (select coalesce(jsonb_object_agg(
                                  case when t.k ~ '^[0-9]+$' and t.k::int >= 5 then (t.k::int + 1)::text else t.k end,
                                  t.v), '{}'::jsonb)
                           from jsonb_each(c.step_times) as t(k, v))
     where c.step_times <> '{}'::jsonb;
  end if;
end $$;

-- ---------------------------------------------------------------- stages
insert into public.stages (step, title, intro, scenario, choice_count, code_count) values
(1, 'Web and tools',         'Quick questions on HTTP, APIs and Git.',                                         false, 4, 0),
(2, 'Databases and SQL',     'Querying and designing relational data.',                                       false, 4, 0),
(3, 'Code reading',          'Predict what short programs do. Each one is in a different language.',          false, 5, 0),
(4, 'Frameworks',            'Questions on the frameworks used across our stacks.',                           false, 5, 0),
(5, 'Design and algorithms', 'Software design principles, data structures and complexity.',                  false, 6, 0),
(6, 'Debugging',             'Bugs reported by the MiniEvent team. Find the cause, then fix the main one.',   true,  4, 1),
(7, 'Security',              'Review MiniEvent code for security problems, then secure one endpoint.',        true,  4, 1),
(8, 'Problem solving',       'Write one function in the language of your choice. Clear, correct code earns the most points.', true, 0, 1)
on conflict (step) do update set
  title = excluded.title, intro = excluded.intro, scenario = excluded.scenario,
  choice_count = excluded.choice_count, code_count = excluded.code_count;

insert into public.questions
  (id, stage, lang, kind, title, prompt, snippet, snippet_lang, options, correct, points, rubric)
values

-- =================================================================== STAGE 1 — WEB AND TOOLS
('w_http_201', 1, 'general', 'choice', null,
 $q$A POST request successfully creates a new resource. Which status code should the API return?$q$, null, null,
 '["200 OK", "201 Created", "204 No Content", "302 Found"]', 1, 1, null),

('w_put', 1, 'general', 'choice', null,
 $q$Which HTTP method is idempotent and normally used to replace a resource completely?$q$, null, null,
 '["POST", "PUT", "PATCH", "CONNECT"]', 1, 1, null),

('w_403', 1, 'general', 'choice', null,
 $q$A logged-in user requests a resource they are not allowed to access. Which status code is the most appropriate?$q$, null, null,
 '["400 Bad Request", "401 Unauthorized", "403 Forbidden", "500 Internal Server Error"]', 2, 1, null),

('w_authz', 1, 'general', 'choice', null,
 $q$What is the difference between authentication and authorization?$q$, null, null,
 '["They are two names for the same thing", "Authentication checks who you are; authorization checks what you are allowed to do", "Authentication is for APIs; authorization is for web pages", "Authorization always happens before authentication"]', 1, 1, null),

('w_cors', 1, 'general', 'choice', null,
 $q$A front-end at https://app.example.com calls an API at https://api.example.com, and the browser blocks the response with a CORS error. What has to change?$q$, null, null,
 '["The front-end must be served over HTTP instead of HTTPS", "The API must send Access-Control-Allow-Origin headers that allow https://app.example.com", "The API must always answer with status 200", "The browser cache must be cleared"]', 1, 1, null),

('w_httponly', 1, 'general', 'choice', null,
 $q$What does the HttpOnly flag on a cookie do?$q$, null, null,
 '["It sends the cookie only over HTTP, never HTTPS", "It prevents JavaScript running in the page from reading the cookie", "It deletes the cookie when the tab is closed", "It encrypts the cookie value"]', 1, 1, null),

('w_content_type', 1, 'general', 'choice', null,
 $q$Which request header tells the server that the request body is JSON?$q$, null, null,
 '["Accept: application/json", "Content-Type: application/json", "Authorization: application/json", "Content-Length: json"]', 1, 1, null),

('w_rest_url', 1, 'general', 'choice', null,
 $q$Which endpoint follows REST conventions to get the bookings of user 42?$q$, null, null,
 '["GET /users/42/bookings", "GET /getUserBookings?id=42", "POST /users/42/bookings/list", "GET /bookings/delete/42"]', 0, 1, null),

('w_git_branch', 1, 'general', 'choice', null,
 $q$Which Git command creates a new branch called feature-login and switches to it?$q$, null, null,
 '["git branch -m feature-login", "git merge feature-login", "git checkout -b feature-login", "git push origin feature-login"]', 2, 1, null),

('w_git_reset', 1, 'general', 'choice', null,
 $q$You made a commit on the wrong branch and have not pushed it yet. Which command undoes the last commit but keeps your changes?$q$, null, null,
 '["git reset --hard HEAD~1", "git reset --soft HEAD~1", "git clean -fd", "git checkout HEAD~1"]', 1, 1, null),

-- =================================================================== STAGE 2 — DATABASES AND SQL
('q_group', 2, 'sql', 'choice', null,
 $q$Table users(id, name, country). Which query returns the number of users in each country?$q$, null, null,
 '["SELECT country, COUNT(*) FROM users GROUP BY country", "SELECT country, COUNT(*) FROM users ORDER BY country", "SELECT DISTINCT country, COUNT(id) FROM users", "SELECT country FROM users WHERE COUNT(*) > 0"]', 0, 1, null),

('q_left_join', 2, 'sql', 'choice', null,
 $q$You need ALL customers, including those who never ordered, with their orders when they exist. Which join do you use, with customers on the left?$q$, null, null,
 '["INNER JOIN orders", "LEFT JOIN orders", "CROSS JOIN orders", "RIGHT JOIN orders with WHERE orders.id IS NOT NULL"]', 1, 1, null),

('q_count_zero', 2, 'sql', 'choice', null,
 $q$Tables events(id, title, capacity) and bookings(id, event_id, user_id). Which query lists every event with its number of bookings, showing 0 for events without bookings?$q$, null, null,
 '["SELECT e.title, COUNT(*) FROM events e JOIN bookings b ON b.event_id = e.id GROUP BY e.title", "SELECT e.title, COUNT(b.id) FROM events e LEFT JOIN bookings b ON b.event_id = e.id GROUP BY e.id, e.title", "SELECT e.title, COUNT(*) FROM events e LEFT JOIN bookings b ON b.event_id = e.id GROUP BY e.id, e.title", "SELECT title, COUNT(event_id) FROM events, bookings GROUP BY title"]', 1, 1, null),

('q_having', 2, 'sql', 'choice', null,
 $q$Which clause filters groups after aggregation, for example "only events with more than 10 bookings"?$q$, null, null,
 '["WHERE", "HAVING", "ORDER BY", "LIMIT"]', 1, 1, null),

('q_index', 2, 'sql', 'choice', null,
 $q$SELECT * FROM bookings WHERE user_id = ? has become slow now that the table has millions of rows. What is the most likely fix?$q$, null, null,
 '["Add an index on bookings.user_id", "Replace SELECT * with SELECT DISTINCT *", "Add ORDER BY user_id", "Store user_id as text"]', 0, 1, null),

('q_fk', 2, 'sql', 'choice', null,
 $q$bookings.event_id has a FOREIGN KEY constraint referencing events.id. What does it guarantee?$q$, null, null,
 '["Each booking has a unique event_id", "Each non-null event_id matches an existing event", "Bookings are sorted by event", "Queries on event_id are automatically faster"]', 1, 1, null),

('q_null', 2, 'sql', 'choice', null,
 $q$Which condition correctly finds users whose email is missing (NULL)?$q$, null, null,
 '["WHERE email = NULL", "WHERE email IS NULL", "WHERE email == NULL", "WHERE email = ''''"]', 1, 1, null),

('q_transaction', 2, 'sql', 'choice', null,
 $q$What does a database transaction guarantee for a group of statements?$q$, null, null,
 '["They run faster", "Either all of them are applied, or none of them are", "They can be run by one user only", "They are written to a log file for debugging"]', 1, 1, null),

('q_latest', 2, 'sql', 'choice', null,
 $q$Which query returns the 3 most recent bookings?$q$, null, null,
 '["SELECT * FROM bookings ORDER BY created_at LIMIT 3", "SELECT * FROM bookings ORDER BY created_at DESC LIMIT 3", "SELECT * FROM bookings GROUP BY created_at LIMIT 3", "SELECT MAX(created_at, 3) FROM bookings"]', 1, 1, null),

-- =================================================================== STAGE 3 — CODE READING
-- JavaScript
('r_js_map', 3, 'js', 'choice', null, $q$What does this code print?$q$,
 $c$console.log([1, 2, 3].map(x => x * 2).filter(x => x > 2));$c$, 'javascript',
 '["[2, 4, 6]", "[4, 6]", "[3]", "[2]"]', 1, 1, null),

('r_js_loop', 3, 'js', 'choice', null, $q$In which order are the letters printed?$q$,
 $c$console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
console.log('D');$c$, 'javascript',
 '["A B C D", "A D B C", "A D C B", "A C D B"]', 2, 1, null),

('r_js_coerce', 3, 'js', 'choice', null, $q$What does this code print?$q$,
 $c$console.log(0.1 + 0.2 === 0.3, "5" + 3, "5" - 3);$c$, 'javascript',
 '["true 8 2", "false 53 2", "false 8 2", "true 53 53"]', 1, 1, null),

('r_js_ref', 3, 'js', 'choice', null, $q$What does this code print?$q$,
 $c$const a = { n: 1 };
const b = a;
b.n = 2;
console.log(a.n);$c$, 'javascript',
 '["1", "2", "undefined", "TypeError: assignment to constant"]', 1, 1, null),

-- Java
('r_java_equals', 3, 'java', 'choice', null, $q$What does this code print?$q$,
 $c$String a = new String("hi");
String b = new String("hi");
System.out.println(a == b);
System.out.println(a.equals(b));$c$, 'java',
 '["true then true", "false then true", "true then false", "false then false"]', 1, 1, null),

('r_java_div', 3, 'java', 'choice', null, $q$What does this code print?$q$,
 $c$int a = 7, b = 2;
System.out.println(a / b + " " + a % b);$c$, 'java',
 '["3.5 1", "3 1", "3 1.5", "4 1"]', 1, 1, null),

('r_java_remove', 3, 'java', 'choice', null, $q$What does this code print?$q$,
 $c$List<Integer> list = new ArrayList<>(List.of(1, 2, 3));
list.remove(1);
System.out.println(list);$c$, 'java',
 '["[2, 3]", "[1, 3]", "[1, 2]", "An exception is thrown"]', 1, 1, null),

('r_java_immutable', 3, 'java', 'choice', null, $q$What does this code print?$q$,
 $c$String s = "abc";
s.toUpperCase();
System.out.println(s);$c$, 'java',
 '["abc", "ABC", "Abc", "null"]', 0, 1, null),

-- C#
('r_cs_linq', 3, 'csharp', 'choice', null, $q$What does the list r contain?$q$,
 $c$var r = new[] { 1, 2, 3, 4 }
    .Where(x => x % 2 == 0)
    .Select(x => x * 10)
    .ToList();$c$, 'csharp',
 '["[10, 30]", "[20, 40]", "[10, 20, 30, 40]", "[2, 4]"]', 1, 1, null),

('r_cs_struct', 3, 'csharp', 'choice', null, $q$What does this program print?$q$,
 $c$var a = new Point { X = 1 };
var b = a;
b.X = 2;
Console.WriteLine(a.X);

struct Point { public int X; }$c$, 'csharp',
 '["1", "2", "0", "It does not compile"]', 0, 1, null),

('r_cs_null', 3, 'csharp', 'choice', null, $q$What does this code print?$q$,
 $c$string? name = null;
Console.WriteLine(name ?? "guest");
Console.WriteLine(name?.Length ?? 0);$c$, 'csharp',
 '["guest then 0", "null then 0", "guest then a NullReferenceException", "an empty line then 0"]', 0, 1, null),

('r_cs_div', 3, 'csharp', 'choice', null, $q$What does this code print?$q$,
 $c$Console.WriteLine($"{7 / 2} {7 / 2.0}");$c$, 'csharp',
 '["3.5 3.5", "3 3.5", "3 3", "4 3.5"]', 1, 1, null),

-- PHP
('r_php_copy', 3, 'php', 'choice', null, $q$What does this code print?$q$,
 $c$$x = ['a' => 1];
$y = $x;
$y['a'] = 2;
echo $x['a'];$c$, 'php',
 '["1", "2", "Array", "An error"]', 0, 1, null),

('r_php_concat', 3, 'php', 'choice', null, $q$What does this code print?$q$,
 $c$echo "5" + "3", " ", "5" . "3";$c$, 'php',
 '["53 8", "8 53", "8 8", "An error"]', 1, 1, null),

('r_php_coalesce', 3, 'php', 'choice', null, $q$What does this code print?$q$,
 $c$$user = [];
echo $user['name'] ?? 'guest';$c$, 'php',
 '["guest", "null", "Nothing, with an undefined index warning", "A fatal error"]', 0, 1, null),

('r_php_strict', 3, 'php', 'choice', null, $q$What does this code print?$q$,
 $c$var_dump("1" == 1, "1" === 1);$c$, 'php',
 '["bool(true) bool(true)", "bool(true) bool(false)", "bool(false) bool(false)", "bool(false) bool(true)"]', 1, 1, null),

-- Python
('r_py_default', 3, 'python', 'choice', null, $q$What does this code print?$q$,
 $c$def add(item, items=[]):
    items.append(item)
    return items

add(1)
print(add(2))$c$, 'python',
 '["[2]", "[1, 2]", "[1]", "An error"]', 1, 1, null),

('r_py_comp', 3, 'python', 'choice', null, $q$What does this code print?$q$,
 $c$print([x * x for x in range(5) if x % 2 == 0])$c$, 'python',
 '["[0, 4, 16]", "[1, 9]", "[4, 16]", "[0, 1, 4, 9, 16]"]', 0, 1, null),

('r_py_alias', 3, 'python', 'choice', null, $q$What does this code print?$q$,
 $c$a = [1, 2, 3]
b = a
b.append(4)
print(len(a))$c$, 'python',
 '["3", "4", "7", "An error"]', 1, 1, null),

('r_py_ops', 3, 'python', 'choice', null, $q$What does this code print?$q$,
 $c$print(7 // 2, 7 / 2, 2 ** 3)$c$, 'python',
 '["3 3.5 8", "3.5 3.5 6", "3 3 8", "3 3.5 6"]', 0, 1, null),

-- =================================================================== STAGE 4 — FRAMEWORKS
-- JavaScript / TypeScript (React, Angular, Vue, Node)
('f_react_state', 4, 'js', 'choice', 'React', $q$Why should you not update React state with items.push(newItem)?$q$,
 $c$const [items, setItems] = useState([]);

function add(newItem) {
  items.push(newItem);
  setItems(items);
}$c$, 'jsx',
 '["push is slower than concat", "React may not detect the change because the array reference is the same, so it may not re-render", "useState only accepts strings", "It creates a memory leak"]', 1, 1, null),

('f_react_effect', 4, 'js', 'choice', 'React', $q$When does this effect run?$q$,
 $c$useEffect(() => {
  loadUser(id);
}, [id]);$c$, 'jsx',
 '["Only once, before the first render", "After the first render and again whenever id changes", "On every render", "Only when the component is removed"]', 1, 1, null),

('f_angular_service', 4, 'js', 'choice', 'Angular', $q$In Angular, what is the recommended way to share data-fetching logic between several components?$q$, null, null,
 '["Copy the code into each component", "An injectable service", "A pipe", "A global variable on window"]', 1, 1, null),

('f_vue_ref', 4, 'js', 'choice', 'Vue', $q$In Vue 3, what does const count = ref(0) give you?$q$, null, null,
 '["A plain number that never updates the view", "A reactive reference; in script code the value is read and written with count.value", "A reference to a DOM element", "A computed property"]', 1, 1, null),

('f_express_hang', 4, 'js', 'choice', 'Node.js / Express', $q$What happens when a request reaches this route?$q$,
 $c$app.get('/events/:id', async (req, res) => {
  const event = await db.findEvent(req.params.id);
  if (event) {
    res.json(event);
  }
});$c$, 'javascript',
 '["If the event does not exist, Express automatically answers 404", "If the event does not exist, no response is sent and the request hangs until it times out", "The route crashes the server", "Express answers 204 automatically"]', 1, 1, null),

-- Java (Spring)
('f_spring_get', 4, 'java', 'choice', 'Spring Boot', $q$In a Spring Boot REST controller, which annotation maps an HTTP GET request to a method?$q$, null, null,
 '["@Get", "@RequestBody", "@GetMapping", "@Autowired"]', 2, 1, null),

('f_spring_di', 4, 'java', 'choice', 'Spring Boot', $q$What does Spring do with the constructor parameter in this class?$q$,
 $c$@Service
public class BookingService {
    private final BookingRepository repository;

    public BookingService(BookingRepository repository) {
        this.repository = repository;
    }
}$c$, 'java',
 '["Nothing; you must call new BookingRepository() yourself", "It injects a BookingRepository bean that it creates and manages", "It creates a new database table", "It makes the field static"]', 1, 1, null),

('f_spring_jpa', 4, 'java', 'choice', 'Spring Data JPA', $q$What does this repository method do?$q$,
 $c$public interface BookingRepository extends JpaRepository<Booking, Long> {
    List<Booking> findByUserId(Long userId);
}$c$, 'java',
 '["Nothing until you write its SQL by hand", "Spring generates the query from the method name and returns the user''s bookings", "It deletes bookings with this user id", "It only works with MongoDB"]', 1, 1, null),

-- C# (.NET)
('f_cs_task', 4, 'csharp', 'choice', 'C#', $q$An async method computes and returns an integer. What should its return type be?$q$, null, null,
 '["int", "Task<int>", "void", "async int"]', 1, 1, null),

('f_aspnet_scoped', 4, 'csharp', 'choice', 'ASP.NET Core', $q$What does this line in Program.cs do?$q$,
 $c$builder.Services.AddScoped<IBookingService, BookingService>();$c$, 'csharp',
 '["Creates one BookingService for the whole application", "Registers BookingService so that one instance is created per HTTP request", "Creates a new instance every time it is injected", "Adds an HTTP route /booking"]', 1, 1, null),

('f_efcore_save', 4, 'csharp', 'choice', 'Entity Framework Core', $q$When is this change written to the database?$q$,
 $c$var ev = await _db.Events.FindAsync(id);
ev.Capacity = 200;$c$, 'csharp',
 '["Immediately, when Capacity is set", "When SaveChanges or SaveChangesAsync is called on the context", "When the method returns", "Never; EF Core is read-only"]', 1, 1, null),

-- PHP (Laravel)
('f_laravel_request', 4, 'php', 'choice', 'Laravel', $q$In Laravel, where is the cleanest place to put validation rules for an incoming request?$q$, null, null,
 '["In the Blade view", "In a Form Request class", "In the migration file", "In the .env file"]', 1, 1, null),

('f_laravel_eloquent', 4, 'php', 'choice', 'Laravel', $q$What does this expression return?$q$,
 $c$Booking::where('user_id', $id)->get();$c$, 'php',
 '["The first matching booking", "A collection of Booking models", "The number of matching bookings", "A raw SQL string"]', 1, 1, null),

('f_laravel_migration', 4, 'php', 'choice', 'Laravel', $q$What is a Laravel migration?$q$, null, null,
 '["A tool to move the app to another server", "Versioned code that creates or changes database tables", "A way to translate the app", "A cache of compiled views"]', 1, 1, null),

-- Python (Django)
('f_django_makemigrations', 4, 'python', 'choice', 'Django', $q$What does python manage.py makemigrations do?$q$, null, null,
 '["Applies pending migrations to the database", "Creates migration files from the changes in your models", "Deletes the database", "Starts the development server"]', 1, 1, null),

('f_django_queryset', 4, 'python', 'choice', 'Django', $q$What does this expression return?$q$,
 $c$Booking.objects.filter(user=request.user)$c$, 'python',
 '["A list loaded immediately with every booking", "A lazy QuerySet that runs its query when it is used", "The first booking of the user", "A dictionary of bookings"]', 1, 1, null),

('f_django_template', 4, 'python', 'choice', 'Django', $q$comment.text contains <script>alert(1)</script>. What happens when this template is rendered with default settings?$q$,
 $c$<p>{{ comment.text }}</p>$c$, null,
 '["The script runs in the browser", "Django escapes it, so it is shown as text", "Django raises an error", "The paragraph is removed"]', 1, 1, null),

-- =================================================================== STAGE 5 — DESIGN AND ALGORITHMS
-- Software design
('g_srp', 5, 'design', 'choice', 'Software design', $q$A UserService class validates input, saves users to the database, sends welcome emails and builds PDF reports. Which principle does it break most clearly?$q$, null, null,
 '["Single responsibility: a class should have one reason to change", "Open/closed principle", "Don''t repeat yourself", "Keep it simple"]', 0, 1, null),

('g_di', 5, 'design', 'choice', 'Software design', $q$Why pass an EmailSender to a class through its constructor, instead of creating it with new inside the class?$q$, null, null,
 '["It makes the code run faster", "The dependency can be replaced, for example by a fake in tests, without changing the class", "It uses less memory", "Constructors cannot call new"]', 1, 1, null),

('g_observer', 5, 'design', 'choice', 'Design patterns', $q$When a booking is created, the app must send an email, update statistics and write an audit log, and more actions will be added later. Which design fits best?$q$, null, null,
 '["Singleton: one global Booking object", "Observer / events: publish a BookingCreated event that independent handlers listen to", "Adapter: convert the booking to another interface", "Builder: build the booking step by step"]', 1, 1, null),

('g_strategy', 5, 'design', 'choice', 'Design patterns', $q$Ticket prices are computed differently for students, members and standard customers, and new pricing rules are added often. What is the cleanest design?$q$, null, null,
 '["One big if/else in the checkout method", "One class per pricing rule behind a common interface (Strategy pattern)", "Copy the checkout method for each type of customer", "Store the rule name in a global variable"]', 1, 1, null),

('g_layers', 5, 'design', 'choice', 'Architecture', $q$In a layered backend (controller, service, repository), where should the rule "a user cannot book more than 4 seats per event" live?$q$, null, null,
 '["In the controller, next to the HTTP code", "In the service (business) layer", "In the repository, inside the SQL query", "Only in the front-end form"]', 1, 1, null),

('g_liskov', 5, 'design', 'choice', 'Software design', $q$Code written for Rectangle sets the width to 5 and the height to 4, then expects an area of 20. With a Square it gets 16. Which principle is broken?$q$,
 $c$class Rectangle {
  setWidth(w)  { this.w = w; }
  setHeight(h) { this.h = h; }
  area()       { return this.w * this.h; }
}

class Square extends Rectangle {
  setWidth(w)  { this.w = w; this.h = w; }
  setHeight(h) { this.w = h; this.h = h; }
}$c$, 'javascript',
 '["Single responsibility", "Liskov substitution: a subclass must work wherever its parent is expected", "Interface segregation", "Don''t repeat yourself"]', 1, 1, null),

('g_coupling', 5, 'design', 'choice', 'Software design', $q$BookingService calls methods of a concrete MySqlBookingRepository class directly. What reduces the coupling between them?$q$, null, null,
 '["Make every method static", "Depend on a BookingRepository interface and inject the implementation", "Merge the two classes", "Make the repository methods public"]', 1, 1, null),

('g_unit_test', 5, 'design', 'choice', 'Testing', $q$Which statement describes a good unit test?$q$, null, null,
 '["It tests one behaviour in isolation and gives the same result on every run", "It needs the production database to run", "It tests the whole application through the browser", "It is written after the release, if there is time"]', 0, 1, null),

('g_normalize', 5, 'design', 'choice', 'Data design', $q$Each booking row stores a copy of the event title and date. When an event title changes, old bookings still show the old title. Which design avoids this?$q$, null, null,
 '["Update every booking row with a nightly script", "Store only event_id in bookings and read the title from events with a join", "Store the title in the browser", "Forbid changing event titles"]', 1, 1, null),

('g_api_version', 5, 'design', 'choice', 'API design', $q$A mobile app in production uses GET /api/events. You must change the format of the response. What is the safest approach?$q$, null, null,
 '["Change the response directly; users will update the app", "Add a new version (for example /api/v2/events) and keep the old one until clients have migrated", "Return both formats mixed in the same JSON", "Rename the endpoint without telling the mobile team"]', 1, 1, null),

-- Algorithms and data structures
('a_binary_search', 5, 'algorithms', 'choice', 'Algorithms', $q$What is the time complexity of binary search in a sorted array of n elements?$q$, null, null,
 '["O(1)", "O(log n)", "O(n)", "O(n log n)"]', 1, 1, null),

('a_nested', 5, 'algorithms', 'choice', 'Algorithms', $q$What is the time complexity of this code?$q$,
 $c$total = 0
for i in range(n):
    for j in range(n):
        total += i * j$c$, 'python',
 '["O(n)", "O(n log n)", "O(n²)", "O(2n)"]', 2, 1, null),

('a_hashset', 5, 'algorithms', 'choice', 'Data structures', $q$You must check millions of times whether an email address is already registered. Which structure gives the fastest average lookup?$q$, null, null,
 '["An unsorted list", "A hash set (or hash map)", "A linked list", "A stack"]', 1, 1, null),

('a_queue', 5, 'algorithms', 'choice', 'Data structures', $q$Booking requests must be processed in arrival order: first come, first served. Which structure fits?$q$, null, null,
 '["A stack (last in, first out)", "A queue (first in, first out)", "A set", "A binary search tree"]', 1, 1, null),

('a_stack_undo', 5, 'algorithms', 'choice', 'Data structures', $q$An editor needs an "Undo" button that cancels the most recent action first. Which structure fits?$q$, null, null,
 '["A queue", "A stack", "A hash map", "A sorted array"]', 1, 1, null),

('a_sorted', 5, 'algorithms', 'choice', 'Algorithms', $q$Which condition must be true before you can use binary search on an array?$q$, null, null,
 '["The array has an even number of elements", "The array is sorted", "The array contains no negative numbers", "The array fits in the CPU cache"]', 1, 1, null),

('a_sort_complexity', 5, 'algorithms', 'choice', 'Algorithms', $q$What is the time complexity of efficient general-purpose sorting algorithms such as merge sort?$q$, null, null,
 '["O(n)", "O(n log n)", "O(n²)", "O(log n)"]', 1, 1, null),

('a_recursion', 5, 'algorithms', 'choice', 'Recursion', $q$What does this code print?$q$,
 $c$function f(n) {
  if (n <= 1) return 1;
  return n * f(n - 1);
}
console.log(f(5));$c$, 'javascript',
 '["5", "15", "120", "It never stops"]', 2, 1, null),

('a_duplicates', 5, 'algorithms', 'choice', 'Algorithms', $q$Which approach finds whether an array contains a duplicate value in O(n) time on average?$q$, null, null,
 '["Compare every element with every other element", "Go through the array once, storing the values already seen in a hash set", "Sort the array, then search each element with binary search", "Count the elements with length()"]', 1, 1, null),

('a_bfs', 5, 'algorithms', 'choice', 'Graphs', $q$Venues are connected by direct shuttle routes, all with the same travel time. Which algorithm finds the route with the fewest stops between two venues?$q$, null, null,
 '["Depth-first search", "Breadth-first search", "Bubble sort", "Binary search"]', 1, 1, null),

-- =================================================================== STAGE 6 — DEBUGGING (choice)
('d_js_await', 6, 'js', 'choice', 'Seats left is NaN', $q$getSeatsLeft returns NaN. What is the cause?$q$,
 $c$async function getSeatsLeft(eventId) {
  const event = db.findEvent(eventId); // returns a Promise
  return event.capacity - event.bookedCount;
}$c$, 'javascript',
 '["capacity is stored as a string", "db.findEvent is not awaited, so event is a Promise and its properties are undefined", "async functions cannot return numbers", "The subtraction must use Math.subtract"]', 1, 2, null),

('d_js_var', 6, 'js', 'choice', 'Reminder ids', $q$This prints 3 3 3 instead of 0 1 2. Why?$q$,
 $c$for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}$c$, 'javascript',
 '["setTimeout runs the callbacks in reverse order", "var is function-scoped, so all callbacks share the same i, which is 3 when they run; use let", "console.log is asynchronous", "The delay of 0 is invalid"]', 1, 2, null),

('d_java_npe', 6, 'java', 'choice', 'Booking page error 500', $q$This endpoint sometimes fails with a NullPointerException. What is the most likely cause?$q$,
 $c$@GetMapping("/bookings/{id}/title")
public String title(@PathVariable Long id) {
    Booking booking = bookingRepository.findById(id).orElse(null);
    return booking.getEvent().getTitle();
}$c$, 'java',
 '["The @PathVariable annotation is wrong", "No booking exists for this id, so booking is null", "getTitle() is private", "Long cannot be used as an id"]', 1, 2, null),

('d_java_integer', 6, 'java', 'choice', 'Owner check fails', $q$For users with large ids, the owner check fails even when the ids are equal. Why?$q$,
 $c$Integer ownerId = booking.getUserId();   // 1000
Integer currentId = currentUser.getId();  // 1000
if (ownerId == currentId) {
    allowEdit();
}$c$, 'java',
 '["Integer cannot hold 1000", "== compares Integer object references; use equals()", "The if needs curly braces on one line", "getId() returns a String"]', 1, 2, null),

('d_cs_full', 6, 'csharp', 'choice', 'One booking too many', $q$An event with capacity 100 already has 100 bookings, yet booking number 101 is accepted. Why?$q$,
 $c$public bool IsFull(Event ev, int booked) => booked > ev.Capacity;$c$, 'csharp',
 '["Capacity should be a long", "The comparison should be booked >= ev.Capacity", "The method should be async", "Expression-bodied methods cannot return bool"]', 1, 2, null),

('d_cs_await', 6, 'csharp', 'choice', 'Missing confirmation emails', $q$Some confirmation emails are never sent and no error appears in the logs. What is the problem?$q$,
 $c$public async Task<IActionResult> Book(int id)
{
    await _bookings.CreateAsync(id, UserId);
    _mailer.SendConfirmationAsync(UserId);   // returns Task
    return Ok();
}$c$, 'csharp',
 '["Ok() must be awaited", "SendConfirmationAsync is not awaited, so failures are lost and the work may be cut short", "Task cannot be returned from a controller", "UserId must be a string"]', 1, 2, null),

('d_php_nplus1', 6, 'php', 'choice', 'Slow events page', $q$With 500 events, this page is very slow. Why?$q$,
 $c$$events = Event::all();
foreach ($events as $event) {
    echo $event->title . ': ' . $event->bookings->count();
}$c$, 'php',
 '["echo is slow in loops", "It runs one extra query per event (N+1 problem); load the counts at once with withCount(''bookings'')", "Event::all() is deprecated", "count() must be replaced by sizeof()"]', 1, 2, null),

('d_php_strpos', 6, 'php', 'choice', 'Admin emails', $q$admin@minievent.com is treated as a normal user. Why?$q$,
 $c$if (strpos($email, 'admin') == false) {
    $role = 'user';
}$c$, 'php',
 '["strpos is case sensitive", "strpos returns 0 (position 0), and 0 == false is true; use === false", "The single quotes must be double quotes", "strpos only works on arrays"]', 1, 2, null),

('d_py_types', 6, 'python', 'choice', 'Capacity check', $q$What happens when this code runs?$q$,
 $c$capacity = request.POST["capacity"]   # "100"
booked = Booking.objects.filter(event=event).count()   # 42
if booked >= capacity:
    raise EventFull()$c$, 'python',
 '["It works: Python converts the text to a number", "A TypeError is raised because an int is compared with a str; convert with int()", "The event is always considered full", "count() returns a string, so it works"]', 1, 2, null),

('d_py_or', 6, 'python', 'choice', 'Everyone is a manager', $q$Every user gets the manager screen. Why?$q$,
 $c$if user.role == "admin" or "manager":
    show_manager_screen()$c$, 'python',
 '["or has lower priority than ==, and \"manager\" is a non-empty string, which is always true; write user.role in (\"admin\", \"manager\")", "user.role is None", "Strings must be compared with is", "show_manager_screen is called twice"]', 0, 2, null),

-- =================================================================== STAGE 6 — DEBUGGING (written)
('d_fix_js', 6, 'js', 'code', 'Fix the overbooking', $q$Events are sometimes overbooked: when two users book the last seat at the same moment, both bookings succeed. Explain why, then fix it (code, SQL or a clear explanation). Your fix must work when the application runs on several servers.$q$,
 $c$app.post('/events/:id/bookings', requireLogin, async (req, res) => {
  const eventId = req.params.id;
  const ev = await db.query('SELECT capacity FROM events WHERE id = $1', [eventId]);
  const { rows } = await db.query(
    'SELECT COUNT(*) AS n FROM bookings WHERE event_id = $1', [eventId]);

  if (Number(rows[0].n) >= ev.rows[0].capacity) {
    return res.status(409).json({ error: 'EVENT_FULL' });
  }
  await db.query(
    'INSERT INTO bookings (event_id, user_id) VALUES ($1, $2)', [eventId, req.user.id]);
  res.status(201).json({ ok: true });
});$c$, 'javascript', null, null, 5, null),

('d_fix_java', 6, 'java', 'code', 'Fix the overbooking', $q$Events are sometimes overbooked: when two users book the last seat at the same moment, both bookings succeed. Explain why, then fix it (code, SQL or a clear explanation). Your fix must work when the application runs on several servers.$q$,
 $c$@PostMapping("/events/{id}/bookings")
public ResponseEntity<?> book(@PathVariable Long id, Principal user) {
    Event event = eventRepository.findById(id).orElseThrow();
    long count = bookingRepository.countByEventId(id);

    if (count >= event.getCapacity()) {
        return ResponseEntity.status(409).body("EVENT_FULL");
    }
    bookingRepository.save(new Booking(id, user.getName()));
    return ResponseEntity.status(201).build();
}$c$, 'java', null, null, 5, null),

('d_fix_csharp', 6, 'csharp', 'code', 'Fix the overbooking', $q$Events are sometimes overbooked: when two users book the last seat at the same moment, both bookings succeed. Explain why, then fix it (code, SQL or a clear explanation). Your fix must work when the application runs on several servers.$q$,
 $c$[Authorize]
[HttpPost("events/{id}/bookings")]
public async Task<IActionResult> Book(int id)
{
    var ev = await _db.Events.FindAsync(id);
    var count = await _db.Bookings.CountAsync(b => b.EventId == id);

    if (count >= ev.Capacity)
        return Conflict("EVENT_FULL");

    _db.Bookings.Add(new Booking { EventId = id, UserId = User.Identity.Name });
    await _db.SaveChangesAsync();
    return StatusCode(201);
}$c$, 'csharp', null, null, 5, null),

('d_fix_php', 6, 'php', 'code', 'Fix the overbooking', $q$Events are sometimes overbooked: when two users book the last seat at the same moment, both bookings succeed. Explain why, then fix it (code, SQL or a clear explanation). Your fix must work when the application runs on several servers.$q$,
 $c$public function book(Request $request, int $id)
{
    $event = Event::findOrFail($id);
    $count = Booking::where('event_id', $id)->count();

    if ($count >= $event->capacity) {
        return response()->json(['error' => 'EVENT_FULL'], 409);
    }
    Booking::create(['event_id' => $id, 'user_id' => $request->user()->id]);
    return response()->json(['ok' => true], 201);
}$c$, 'php', null, null, 5, null),

('d_fix_python', 6, 'python', 'code', 'Fix the overbooking', $q$Events are sometimes overbooked: when two users book the last seat at the same moment, both bookings succeed. Explain why, then fix it (code, SQL or a clear explanation). Your fix must work when the application runs on several servers.$q$,
 $c$@login_required
@require_POST
def book(request, event_id):
    event = get_object_or_404(Event, pk=event_id)
    count = Booking.objects.filter(event_id=event_id).count()

    if count >= event.capacity:
        return JsonResponse({"error": "EVENT_FULL"}, status=409)

    Booking.objects.create(event_id=event_id, user=request.user)
    return JsonResponse({"ok": True}, status=201)$c$, 'python', null, null, 5, null),

-- =================================================================== STAGE 7 — SECURITY (choice)
('s_passwords', 7, 'general', 'choice', null, $q$How should user passwords be stored?$q$, null, null,
 '["Encrypted with AES so they can be shown to the user if forgotten", "Encoded in Base64", "Hashed with MD5", "Hashed with a slow, salted algorithm such as bcrypt or Argon2"]', 3, 2, null),

('s_sqli', 7, 'general', 'choice', null, $q$What is the most effective protection against SQL injection?$q$, null, null,
 '["Removing quotes from user input", "Parameterized queries (prepared statements) or a safe ORM", "Sending forms with POST instead of GET", "Hiding database error messages"]', 1, 2, null),

('s_idor', 7, 'general', 'choice', null, $q$A user changes /api/bookings/1001 to /api/bookings/1002 in the URL and sees another person's booking. What is missing?$q$, null, null,
 '["HTTPS", "A check that the booking belongs to the logged-in user", "A longer session timeout", "Rate limiting"]', 1, 2, null),

('s_stored_xss', 7, 'general', 'choice', null, $q$A comment containing <script> code is saved, then runs in the browser of every user who opens the event page. What is this vulnerability called?$q$, null, null,
 '["SQL injection", "Stored cross-site scripting (XSS)", "Cross-site request forgery (CSRF)", "Denial of service"]', 1, 2, null),

('s_secrets', 7, 'general', 'choice', null, $q$Where should the production database password be kept?$q$, null, null,
 '["In the source code, so every developer has it", "In environment variables or a secrets manager, outside the code repository", "In a comment in the README", "In the front-end configuration file"]', 1, 2, null),

('s_csrf', 7, 'general', 'choice', null, $q$What does a CSRF token protect against?$q$, null, null,
 '["Another website making the user''s browser send unwanted requests to your site", "Passwords being guessed", "SQL injection", "Slow page loads"]', 0, 2, null),

('s_js_react_html', 7, 'js', 'choice', 'React', $q$Comments are written by users. What is the risk in this component?$q$,
 $c$function Comment({ comment }) {
  return <div dangerouslySetInnerHTML={{ __html: comment.text }} />;
}$c$, 'jsx',
 '["None: React escapes everything automatically", "Cross-site scripting: HTML or scripts in a comment run for every reader", "The component re-renders too often", "Comments longer than 255 characters are cut"]', 1, 2, null),

('s_js_jwt', 7, 'js', 'choice', 'Node.js', $q$What is wrong with this token check?$q$,
 $c$function requireLogin(req, res, next) {
  const token = req.headers.authorization.split(' ')[1];
  req.user = jwt.decode(token);   // reads the payload
  next();
}$c$, 'javascript',
 '["Nothing: jwt.decode validates the token", "The signature is never verified, so anyone can forge a token; use jwt.verify with the secret", "Tokens must be sent in the URL", "next() should be called before decoding"]', 1, 2, null),

('s_java_bcrypt', 7, 'java', 'choice', 'Spring Security', $q$Passwords were saved with encoder.encode(raw). How do you check a password at login?$q$,
 $c$PasswordEncoder encoder = new BCryptPasswordEncoder();$c$, 'java',
 '["encoder.encode(raw).equals(user.getPasswordHash())", "encoder.matches(raw, user.getPasswordHash())", "raw.equals(user.getPasswordHash())", "Decrypt the stored hash and compare"]', 1, 2, null),

('s_java_mass', 7, 'java', 'choice', 'Spring Boot', $q$Users can update their profile with this endpoint. What is the risk?$q$,
 $c$@PutMapping("/me")
public User update(@RequestBody User body, Principal principal) {
    User user = userRepository.findByEmail(principal.getName());
    BeanUtils.copyProperties(body, user, "id");
    return userRepository.save(user);
}$c$, 'java',
 '["None: the id is protected", "A user can send fields such as role or isAdmin and give themselves extra rights", "@RequestBody only accepts strings", "save() creates a duplicate user"]', 1, 2, null),

('s_cs_authorize', 7, 'csharp', 'choice', 'ASP.NET Core', $q$Which attribute makes an action available only to authenticated users?$q$, null, null,
 '["[AllowAnonymous]", "[Authorize]", "[HttpGet]", "[ValidateModel]"]', 1, 2, null),

('s_cs_raw_sql', 7, 'csharp', 'choice', 'Entity Framework Core', $q$Which call is safe against SQL injection when term comes from the user?$q$, null, null,
 '["_db.Events.FromSqlRaw(\"SELECT * FROM Events WHERE Title = ''\" + term + \"''\")", "_db.Events.FromSqlInterpolated($\"SELECT * FROM Events WHERE Title = {term}\")", "Both are safe", "Neither can be made safe"]', 1, 2, null),

('s_php_xss', 7, 'php', 'choice', 'PHP', $q$What is the problem with this line, and how do you fix it?$q$,
 $c$echo "<p>Hello " . $_GET['name'] . "</p>";$c$, 'php',
 '["No problem: $_GET is filtered by PHP", "Reflected XSS; escape the output with htmlspecialchars()", "SQL injection; use mysqli_real_escape_string()", "Performance; use print instead of echo"]', 1, 2, null),

('s_php_upload', 7, 'php', 'choice', 'PHP', $q$This code saves profile pictures. What is the main risk?$q$,
 $c$move_uploaded_file(
    $_FILES['photo']['tmp_name'],
    'public/uploads/' . $_FILES['photo']['name']
);$c$, 'php',
 '["The upload folder may fill up", "An attacker can upload a .php file into a public folder and run it on the server", "Images are not resized", "move_uploaded_file is deprecated"]', 1, 2, null),

('s_py_csrf', 7, 'python', 'choice', 'Django', $q$What is the purpose of {% csrf_token %} in a Django form?$q$, null, null,
 '["It encrypts the form data", "It protects against cross-site request forgery", "It logs the user in", "It validates the form fields"]', 1, 2, null),

('s_py_debug', 7, 'python', 'choice', 'Django', $q$Why must DEBUG = True never be used in production?$q$, null, null,
 '["It makes the site slower only", "Error pages reveal code, settings and data to anyone who triggers an error", "It disables the database", "It blocks all logins"]', 1, 2, null),

-- =================================================================== STAGE 7 — SECURITY (written)
('s_fix_js', 7, 'js', 'code', 'Secure the endpoint', $q$Any logged-in user can call this endpoint. Name the security problems, then rewrite it securely in the same language.$q$,
 $c$app.get('/bookings/:id', requireLogin, async (req, res) => {
  const sql = "SELECT * FROM bookings WHERE id = " + req.params.id;
  const { rows } = await db.query(sql);
  if (rows.length === 0) return res.status(404).end();
  res.json(rows[0]);
});$c$, 'javascript', null, null, 5, null),

('s_fix_java', 7, 'java', 'code', 'Secure the endpoint', $q$Any logged-in user can call this endpoint. Name the security problems, then rewrite it securely in the same language.$q$,
 $c$@GetMapping("/bookings/{id}")
public Map<String, Object> get(@PathVariable String id, Principal user) {
    String sql = "SELECT * FROM bookings WHERE id = " + id;
    return jdbcTemplate.queryForMap(sql);
}$c$, 'java', null, null, 5, null),

('s_fix_csharp', 7, 'csharp', 'code', 'Secure the endpoint', $q$Any logged-in user can call this endpoint. Name the security problems, then rewrite it securely in the same language.$q$,
 $c$[Authorize]
[HttpGet("bookings/{id}")]
public async Task<IActionResult> Get(string id)
{
    var booking = await _db.Bookings
        .FromSqlRaw("SELECT * FROM Bookings WHERE Id = " + id)
        .FirstOrDefaultAsync();
    return booking == null ? NotFound() : Ok(booking);
}$c$, 'csharp', null, null, 5, null),

('s_fix_php', 7, 'php', 'code', 'Secure the endpoint', $q$Any logged-in user can call this endpoint. Name the security problems, then rewrite it securely in the same language.$q$,
 $c$public function show(Request $request, $id)
{
    $booking = DB::select("SELECT * FROM bookings WHERE id = " . $id);
    if (!$booking) abort(404);
    return response()->json($booking[0]);
}$c$, 'php', null, null, 5, null),

('s_fix_python', 7, 'python', 'code', 'Secure the endpoint', $q$Any logged-in user can call this endpoint. Name the security problems, then rewrite it securely in the same language.$q$,
 $c$@login_required
def booking_detail(request, booking_id):
    with connection.cursor() as cur:
        cur.execute("SELECT id, event_id, user_id FROM bookings WHERE id = " + booking_id)
        row = cur.fetchone()
    if row is None:
        raise Http404()
    return JsonResponse({"id": row[0], "event_id": row[1], "user_id": row[2]})$c$, 'python', null, null, 5, null),

-- =================================================================== STAGE 8 — PROBLEM SOLVING
('p_allocate', 8, 'any', 'code', 'Allocate the seats', $q$Write a function allocate(capacity, requests) that decides which booking requests are accepted.

requests is a list in arrival order; each request has userId and seats (number of seats wanted).
Process the requests in order. Accept a request only if:
- enough seats remain for the whole request, and
- this user does not already have an accepted request.
Return the list of accepted requests.

Example: capacity 5 and requests
[{userId: "a", seats: 2}, {userId: "b", seats: 4}, {userId: "a", seats: 1}, {userId: "c", seats: 3}]
returns [{userId: "a", seats: 2}, {userId: "c", seats: 3}]$q$, null, null, null, null, 6, null),

('p_top_events', 8, 'any', 'code', 'Most popular events', $q$Write a function topEvents(bookings, n) that returns the titles of the n events with the most bookings.

bookings is a list; each booking has eventId and title.
Sort by number of bookings, highest first. When two events have the same number of bookings, sort them by title in alphabetical order. If there are fewer than n events, return all of them.

Example: n = 2 and bookings
[{eventId: 1, title: "Jazz"}, {eventId: 2, title: "Art"}, {eventId: 1, title: "Jazz"}, {eventId: 3, title: "Rock"}, {eventId: 3, title: "Rock"}]
returns ["Jazz", "Rock"]$q$, null, null, null, null, 6, null),

('p_merge_slots', 8, 'any', 'code', 'Merge the time slots', $q$A venue is booked for several time slots. Write a function merge(slots) that merges overlapping slots.

Each slot is a pair [start, end] in minutes, with start < end. The input is not sorted. Two slots overlap or touch when one starts before or exactly when the other ends.
Return the merged slots sorted by start time.

Example: [[60, 90], [10, 30], [20, 40], [90, 100]]
returns [[10, 40], [60, 100]]$q$, null, null, null, null, 6, null)

on conflict (id) do update set
  stage = excluded.stage, lang = excluded.lang, kind = excluded.kind, title = excluded.title,
  prompt = excluded.prompt, snippet = excluded.snippet, snippet_lang = excluded.snippet_lang,
  options = excluded.options, correct = excluded.correct, points = excluded.points;

-- ------------------------------------------------------------ rubrics
-- Scoring guides shown in the back office for written answers.

update public.questions set rubric = $r$5 points in total.
2 pts: explains the race condition: counting and inserting are two separate steps, so both requests can read "1 seat left" before either one inserts.
2 pts: a fix that works in the database, for example:
  - a transaction that locks the event row (SELECT ... FOR UPDATE, pessimistic lock, lockForUpdate(), select_for_update()) before counting and inserting;
  - an atomic conditional update: UPDATE events SET seats_left = seats_left - 1 WHERE id = ? AND seats_left > 0, then checking the number of affected rows;
  - optimistic locking with a version column and a retry.
  Give only 1 pt for a transaction without locking or a correct isolation level.
1 pt: says that an in-memory lock, mutex or synchronized block is not enough when the app runs on several servers.
No points deducted for syntax slips. Bonus remark (no points): suggests UNIQUE(event_id, user_id) against double booking by the same user.$r$
where id like 'd_fix_%';

update public.questions set rubric = $r$5 points in total.
1 pt: names both problems: SQL injection (the id is concatenated into the SQL) and missing ownership check (any logged-in user can read any booking, IDOR).
2 pts: removes the concatenation: parameterized query, prepared statement or an ORM lookup.
2 pts: checks ownership: filters by id AND the logged-in user's id, or compares after loading. Returns 404 (preferred, does not reveal the booking exists) or 403.
Deduct 1 pt if the fix trusts a user id sent by the client (request body or query string).$r$
where id like 's_fix_%';

update public.questions set rubric = $r$6 points in total.
2 pts: correct result on the example (a:2 and c:3 accepted).
1 pt: seats are subtracted only for accepted requests.
1 pt: a second request from an already accepted user is rejected, even if seats remain (uses a set or map, not a nested loop that breaks).
1 pt: a request that does not fit is skipped, but later smaller requests can still be accepted (does not stop at the first refusal).
1 pt: readable code: clear names, no global state, edge cases (capacity 0, empty list).$r$
where id = 'p_allocate';

update public.questions set rubric = $r$6 points in total.
2 pts: counts bookings per event correctly (map or dictionary keyed by eventId).
1 pt: sorts by count, highest first.
1 pt: breaks ties by title alphabetically.
1 pt: returns at most n titles and handles n greater than the number of events.
1 pt: readable code: clear names, no unnecessary nested loops.$r$
where id = 'p_top_events';

update public.questions set rubric = $r$6 points in total.
1 pt: sorts the slots by start time first.
2 pts: merges overlapping slots correctly, extending the end with max(end1, end2) (handles a slot fully inside another).
1 pt: treats touching slots (end == next start) as overlapping, as required.
1 pt: correct result on the example: [[10, 40], [60, 100]].
1 pt: readable code; handles an empty list; does not modify the input in a surprising way.$r$
where id = 'p_merge_slots';
